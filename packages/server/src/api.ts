import { EventEmitter } from 'node:events';
import { dirname as pathDirname, resolve as resolvePath } from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import {
    AcWiringSchema,
    CONFIG_KEY_INDEX,
    DCBatteryProfileSchema,
    DEFAULT_AC_WIRING,
    DEVICE_DEFAULTS,
    type Device,
    DeviceTypeSchema,
    PhaseModeSchema,
    SCENARIO_PRESETS,
    ScenarioSchema,
} from '@ocpp-sim/core';
import Fastify from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { BenchmarkEngine } from './benchmark-engine.js';
import type { DeviceManager } from './device-manager.js';
import { registry as metricsRegistry } from './metrics.js';
import type { Store } from './store.js';

interface BuildArgs {
    store: Store;
    manager: DeviceManager;
    defaultOcppUrl: string;
    /** When set, every /api/* and /metrics request must carry
     *  `Authorization: Bearer <token>`. /api/health stays open. */
    authToken?: string | null;
    /** Absolute path to the web bundle. When set, Fastify-static
     *  serves /assets and SPA-fallback to index.html. */
    webDistDir?: string | null;
}

export async function buildServer({ store, manager, defaultOcppUrl, authToken, webDistDir }: BuildArgs) {
    const app = Fastify({ logger: { level: 'info' } });
    await app.register(cors, { origin: true });
    await app.register(websocket);

    // Bearer-token gate. When AUTH_TOKEN is set, every /api/* and
    // /metrics request needs the right token. /api/health stays open
    // so health probes don't require credentials. /api/auth/ping is
    // also open so the SPA can verify a token before storing it.
    if (authToken) {
        app.addHook('onRequest', async (req, reply) => {
            const url = req.url ?? '';
            const path = url.split('?')[0] ?? url;
            const isProtected =
                (path.startsWith('/api/') || path.startsWith('/metrics')) &&
                path !== '/api/health' &&
                path !== '/api/auth/ping';
            if (!isProtected) return;
            // Three places a client can put the token, in order of
            // preference: Authorization header, ?token= query param
            // (browser WebSocket has no way to set headers), or the
            // Sec-WebSocket-Protocol header (subprotocol).
            const header = req.headers.authorization ?? '';
            let presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
            if (!presented) {
                const qIdx = url.indexOf('?');
                if (qIdx >= 0) {
                    const params = new URLSearchParams(url.slice(qIdx + 1));
                    presented = params.get('token') ?? '';
                }
            }
            if (!presented) {
                const proto = req.headers['sec-websocket-protocol'];
                if (typeof proto === 'string') {
                    // Convention: clients send `bearer.<token>` as a
                    // subprotocol value. We don't echo it back as the
                    // selected protocol — the WS upgrade in fastify-websocket
                    // will pick the first listed one anyway.
                    const parts = proto.split(',').map((s) => s.trim());
                    const bearer = parts.find((p) => p.startsWith('bearer.'));
                    if (bearer) presented = bearer.slice('bearer.'.length);
                }
            }
            const ok = presented.length === authToken.length && presented === authToken;
            if (!ok) {
                reply.code(401).send({ error: 'unauthorized' });
            }
        });
    }

    // Lightweight endpoint the SPA hits to confirm a token is good
    // (or that auth is off). Always 200 — the auth hook above either
    // lets the request through or 401s before we get here.
    app.get('/api/auth/ping', async () => ({ authRequired: Boolean(authToken) }));

    // Mutable so the Settings PUT can update what new devices default to.
    let currentDefaultOcppUrl = defaultOcppUrl;

    /** In-flight benchmark runs, keyed by row id. The engine instance
     *  stays in memory while running so /stop can reach it. Removed
     *  on done/stop. */
    const activeRuns = new Map<number, BenchmarkEngine>();

    /** Single fan-out point for benchmark progress events — the WS hub
     *  subscribes here so it can broadcast without the engine knowing
     *  about WebSockets. */
    const benchmarkBus = new EventEmitter();

    // ---- DEVICES ----

    const CreateDeviceBody = z.object({
        type: DeviceTypeSchema,
        displayName: z.string().min(1).max(80).optional(),
        maxPowerKw: z.number().positive().optional(),
        ocppUrl: z.string().url().optional(),
        authPassword: z.string().min(1).max(200).optional(),
        phaseMode: PhaseModeSchema.optional(),
        dcProfile: DCBatteryProfileSchema.partial().optional(),
    });

    app.get('/api/devices', async () => {
        const devices = store.listDevices();
        return devices.map((d) => withRuntime(d, manager, store));
    });

    /** Build a fully-defaulted Device row from a partial spec. Used by
     *  both the single-device POST and the bulk endpoint so the two
     *  can't drift on what "fresh device" means. */
    const buildDevice = (input: {
        type: 'AC' | 'DC';
        displayName?: string;
        maxPowerKw?: number;
        ocppUrl?: string;
        authPassword?: string;
        phaseMode?: 'balanced' | 'imbalanced' | 'single-phase';
        dcProfile?: Partial<z.infer<typeof DCBatteryProfileSchema>>;
    }): Device => {
        const id = `cp_${uuid().slice(0, 8)}`;
        const defaults = DEVICE_DEFAULTS[input.type];
        return {
            id,
            displayName: input.displayName ?? `${input.type} ${id}`,
            type: input.type,
            model: defaults.model,
            vendor: 'Eveys',
            firmwareVersion: '1.0.0',
            maxPowerKw: input.maxPowerKw ?? defaults.maxPowerKw,
            ocppUrl: input.ocppUrl ?? currentDefaultOcppUrl,
            authPassword: input.authPassword,
            phaseMode: input.phaseMode ?? 'balanced',
            acWiring: input.type === 'AC' ? DEFAULT_AC_WIRING : undefined,
            dcProfile:
                input.type === 'DC'
                    ? { ...DCBatteryProfileSchema.parse({ capacityKwh: 60, chargerMaxKw: defaults.maxPowerKw }), ...input.dcProfile }
                    : undefined,
            createdAt: new Date().toISOString(),
        };
    };

    app.post('/api/devices', async (req, reply) => {
        const body = CreateDeviceBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const device = buildDevice(body.data);
        store.insertDevice(device);
        await manager.spawn(device);
        return withRuntime(device, manager, store);
    });

    // ---- BULK DEVICE CREATE ----
    //
    // Spawns N devices with a small stagger between WS opens so the
    // gateway doesn't see a thundering herd. Returns the persisted
    // rows immediately; the OCPP boot/reconnect happens async on each
    // worker the same way single-create does.

    const BulkCreateBody = z.object({
        count: z.number().int().positive().max(200),
        type: DeviceTypeSchema,
        namePrefix: z.string().min(1).max(40).optional(),
        ocppUrl: z.string().url().optional(),
        staggerMs: z.number().int().min(0).max(5000).default(200),
    });

    app.post('/api/devices/bulk', async (req, reply) => {
        const body = BulkCreateBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const created: Device[] = [];
        for (let i = 0; i < body.data.count; i++) {
            const d = buildDevice({
                type: body.data.type,
                displayName: body.data.namePrefix ? `${body.data.namePrefix} ${i + 1}` : undefined,
                ocppUrl: body.data.ocppUrl,
            });
            store.insertDevice(d);
            created.push(d);
            // Don't await spawn() — fire-and-forget so the response
            // doesn't block on N WebSocket handshakes.
            void manager.spawn(d);
            if (body.data.staggerMs > 0 && i < body.data.count - 1) {
                await new Promise((r) => setTimeout(r, body.data.staggerMs));
            }
        }
        return { created: created.length, devices: created.map((d) => withRuntime(d, manager, store)) };
    });

    app.get<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
        const d = store.getDevice(req.params.id);
        if (!d) return reply.code(404).send({ error: 'not found' });
        return withRuntime(d, manager, store);
    });

    const PatchDeviceBody = z.object({
        displayName: z.string().min(1).max(80).optional(),
        vendor: z.string().min(1).max(80).optional(),
        firmwareVersion: z.string().min(1).max(40).optional(),
        maxPowerKw: z.number().positive().max(1000).optional(),
        ocppUrl: z.string().url().optional(),
        // Empty string clears the password (back to anonymous). max(0) allows
        // it explicitly, otherwise z.string().min(1) would block the clear.
        authPassword: z.string().max(200).optional(),
        phaseMode: PhaseModeSchema.optional(),
        acWiring: AcWiringSchema.partial().optional(),
        dcProfile: DCBatteryProfileSchema.partial().optional(),
    });

    /** Editing any of these requires reconnecting the OCPP socket so
     *  the gateway sees the new BootNotification. We refuse the edit
     *  if a session is active rather than yanking it mid-charge. */
    const RESPAWN_FIELDS = ['vendor', 'firmwareVersion', 'maxPowerKw', 'ocppUrl', 'authPassword'] as const;

    app.patch<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
        const body = PatchDeviceBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const existing = store.getDevice(req.params.id);
        if (!existing) return reply.code(404).send({ error: 'not found' });

        const changedRespawnFields = RESPAWN_FIELDS.filter(
            (f) => body.data[f] !== undefined && body.data[f] !== existing[f],
        );
        if (changedRespawnFields.length > 0 && manager.hasActiveSession(req.params.id)) {
            return reply.code(409).send({
                error: `cannot edit ${changedRespawnFields.join(', ')} while a session is active — stop the session first`,
            });
        }

        const mergedDcProfile = body.data.dcProfile
            ? DCBatteryProfileSchema.parse({ ...(existing.dcProfile ?? {}), ...body.data.dcProfile })
            : existing.dcProfile;

        const mergedAcWiring = body.data.acWiring
            ? AcWiringSchema.parse({ ...(existing.acWiring ?? DEFAULT_AC_WIRING), ...body.data.acWiring })
            : existing.acWiring;

        // Model string is derived from type + maxPowerKw so BootNotification
        // matches the active config (the gateway sees `Eveys-22kW-AC` etc.).
        const maxPowerKw = body.data.maxPowerKw ?? existing.maxPowerKw;
        const model =
            body.data.maxPowerKw !== undefined
                ? `Eveys-${Math.round(maxPowerKw)}kW-${existing.type}`
                : existing.model;

        // authPassword: undefined in the body means "leave alone". An
        // explicit empty string clears it (back to anonymous WS upgrade).
        const mergedAuthPassword =
            body.data.authPassword === undefined
                ? existing.authPassword
                : body.data.authPassword === ''
                  ? undefined
                  : body.data.authPassword;

        const merged: Device = {
            ...existing,
            displayName: body.data.displayName ?? existing.displayName,
            vendor: body.data.vendor ?? existing.vendor,
            firmwareVersion: body.data.firmwareVersion ?? existing.firmwareVersion,
            maxPowerKw,
            model,
            ocppUrl: body.data.ocppUrl ?? existing.ocppUrl,
            authPassword: mergedAuthPassword,
            phaseMode: body.data.phaseMode ?? existing.phaseMode,
            acWiring: mergedAcWiring,
            dcProfile: mergedDcProfile,
        };

        store.updateDevice(req.params.id, {
            displayName: merged.displayName,
            vendor: merged.vendor,
            firmwareVersion: merged.firmwareVersion,
            maxPowerKw: merged.maxPowerKw,
            ocppUrl: merged.ocppUrl,
            authPassword: body.data.authPassword === '' ? '' : merged.authPassword,
            phaseMode: merged.phaseMode,
            acWiring: merged.acWiring,
            dcProfile: merged.dcProfile,
        });
        // Model lives in the same row but isn't in the patch type (clients
        // can't set it directly). Update it via raw SQL when it changed.
        if (model !== existing.model) {
            store.db.prepare(`UPDATE devices SET model = ? WHERE id = ?`).run(model, req.params.id);
        }

        if (changedRespawnFields.length > 0) {
            await manager.respawn(merged);
        } else {
            // Push the edit into the running Simulator so the next tick
            // / next status frame uses the new wiring / phase mode /
            // dc profile / name. Without this the in-memory device
            // snapshot stays stale until restart.
            manager.get(req.params.id)?.applyDeviceEdit({
                displayName: merged.displayName,
                phaseMode: merged.phaseMode,
                acWiring: merged.acWiring,
                dcProfile: merged.dcProfile,
            });
        }
        return withRuntime(merged, manager, store);
    });

    app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
        // Despawn ends any active session with reason='Other' (operator
        // delete), then we soft-delete the row so historical sessions
        // keep their FK target.
        await manager.despawn(req.params.id, 'Other');
        const removed = store.deleteDevice(req.params.id);
        if (!removed) return reply.code(404).send({ error: 'not found' });
        return reply.code(204).send();
    });

    // ---- DEVICE OCPP CONFIG ----
    //
    // Mirrors what a CSMS sees through GetConfiguration / ChangeConfiguration
    // but with extra per-key metadata (type, default, description) that
    // makes a UI useful. Wire-shape statuses come straight from the
    // OCPP enum: Accepted / Rejected / NotSupported / RebootRequired.

    app.get<{ Params: { id: string } }>('/api/devices/:id/config', async (req, reply) => {
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        const oc = sim.getOcppConfig();
        // Enrich each known key with its spec — UIs use this to choose
        // the right input control (bool toggle, int field, csv editor)
        // and to show the operator why a key won't accept a write.
        const keys = oc.configurationKey.map((k) => {
            const spec = CONFIG_KEY_INDEX.get(k.key);
            return {
                key: k.key,
                value: k.value ?? '',
                readonly: k.readonly,
                type: spec?.type ?? 'string',
                default: spec?.default ?? '',
                rebootRequired: spec?.rebootRequired ?? false,
                description: spec?.description ?? null,
            };
        });
        return { keys };
    });

    const PutConfigBody = z.object({ value: z.string() });
    app.put<{ Params: { id: string; key: string }; Body: { value: string } }>(
        '/api/devices/:id/config/:key',
        async (req, reply) => {
            const body = PutConfigBody.safeParse(req.body);
            if (!body.success) return reply.code(400).send({ error: body.error.message });
            const sim = manager.get(req.params.id);
            if (!sim) return reply.code(404).send({ error: 'device not found' });
            const status = sim.setOcppConfig(req.params.key, body.data.value);
            // Fetch the post-write value so the client can re-render
            // without a follow-up GET. Even on Rejected the value
            // doesn't change, but returning it keeps the client cache
            // honest if the UI shows a value preview.
            const after = sim
                .getOcppConfig([req.params.key])
                .configurationKey.find((k) => k.key === req.params.key);
            return { status, key: req.params.key, value: after?.value ?? body.data.value };
        },
    );

    /** Bulk config write — { changes: { key: value, ... } }. Each key
     *  is applied independently; partial failures don't abort the
     *  batch. Returns one row per requested key with the same wire
     *  status the per-key endpoint would have produced. UI uses this
     *  for "Save all dirty rows" so an operator flipping 5 keys hits
     *  one round trip instead of five. */
    const PutBulkConfigBody = z.object({
        changes: z.record(z.string(), z.string()),
    });
    app.put<{ Params: { id: string }; Body: { changes: Record<string, string> } }>(
        '/api/devices/:id/config',
        async (req, reply) => {
            const body = PutBulkConfigBody.safeParse(req.body);
            if (!body.success) return reply.code(400).send({ error: body.error.message });
            const sim = manager.get(req.params.id);
            if (!sim) return reply.code(404).send({ error: 'device not found' });
            const entries = Object.entries(body.data.changes);
            const results = entries.map(([key, value]) => {
                const status = sim.setOcppConfig(key, value);
                const after = sim
                    .getOcppConfig([key])
                    .configurationKey.find((k) => k.key === key);
                return { key, status, value: after?.value ?? value };
            });
            return { results };
        },
    );

    // ---- DELETED DEVICES (admin) ----
    //
    // Soft-delete leaves rows in the table with deleted_at set so the
    // session FK survives. These endpoints expose the trash bin: list,
    // restore back into the live fleet, or purge permanently (which
    // cascades through sessions/config/profiles).

    app.get('/api/devices/deleted', async () => {
        return store.listDeletedDevices();
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/restore', async (req, reply) => {
        const restored = store.restoreDevice(req.params.id);
        if (!restored) return reply.code(404).send({ error: 'not found or not deleted' });
        // Re-spawn the simulator so the device is live again. spawn()
        // is idempotent — if something raced and the sim is already
        // present, this is a no-op.
        await manager.spawn(restored);
        return withRuntime(restored, manager, store);
    });

    app.delete<{ Params: { id: string }; Querystring: { confirm?: string } }>(
        '/api/devices/:id/purge',
        async (req, reply) => {
            // Purge cascades through sessions / config / profiles. Refuse
            // unless the caller passes ?confirm=PURGE — query param,
            // not body, because DELETE-with-body is a quirky habit some
            // proxies and HTTP clients strip silently. Settings reset
            // uses a body confirm because it's a POST; this one fits
            // the verb better as a query string.
            if (req.query.confirm !== 'PURGE') {
                return reply.code(400).send({ error: 'purge requires ?confirm=PURGE' });
            }
            const purged = store.purgeDevice(req.params.id);
            if (!purged) return reply.code(404).send({ error: 'not found or not deleted' });
            return reply.code(204).send();
        },
    );

    // ---- SESSIONS ----

    const StartSessionBody = z.object({
        connectorId: z.number().int().positive(),
        idTag: z.string().min(1).optional(),
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/sessions', async (req, reply) => {
        const body = StartSessionBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        if (!sim.snapshot().online) return reply.code(409).send({ error: 'device offline' });

        const idTag = body.data.idTag ?? `TEST-TAG-C${body.data.connectorId}`;

        // Persist the session row first so we have an id to thread through.
        const sessionRowId = store.insertSession({
            deviceId: req.params.id,
            connectorId: body.data.connectorId,
            transactionId: 0, // placeholder; updated below would require an updateSession() but we don't expose tx id at row level — keep 0 then patch via SQL if needed
            idTag,
            status: 'active',
            startedAt: new Date().toISOString(),
            endedAt: null,
            endReason: null,
            energyWh: 0,
            peakPowerKw: 0,
        });
        try {
            const transactionId = await sim.startSession(body.data.connectorId, idTag, sessionRowId);
            // Patch the placeholder transaction_id with the real one from the gateway.
            store.db
                .prepare(`UPDATE sessions SET transaction_id = ? WHERE id = ?`)
                .run(transactionId, sessionRowId);
            return { sessionId: sessionRowId, transactionId };
        } catch (err) {
            store.endSession({ id: sessionRowId, endedAt: new Date().toISOString(), endReason: 'aborted', energyWh: 0, peakPowerKw: 0 });
            return reply.code(500).send({ error: (err as Error).message });
        }
    });

    const StopSessionBody = z.object({
        connectorId: z.number().int().positive(),
        reason: z.string().default('Local'),
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/sessions/stop', async (req, reply) => {
        const body = StopSessionBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        try {
            // The session-row update is handled by the manager's
            // 'session: stopped' listener in index.ts, regardless of
            // who initiated the stop (manual, remote, fault, e-stop).
            const result = await sim.stopSession(body.data.connectorId, body.data.reason);
            return { ok: true, ...result };
        } catch (err) {
            return reply.code(500).send({ error: (err as Error).message });
        }
    });

    // ---- MANUAL / PHYSICAL ACTIONS ----
    //
    // Each endpoint maps to a Simulator method that drives the real
    // OCPP semantics — these are the moral equivalents of "user walks
    // up to the charger and …" actions surfaced from the UI for testing.

    const ConnectorIdBody = z.object({ connectorId: z.number().int().positive() });

    const SwipeBody = z.object({
        connectorId: z.number().int().positive(),
        idTag: z.string().min(1).max(20),
    });

    const FaultBody = z.object({
        connectorId: z.number().int().positive(),
        errorCode: z
            .enum([
                'ConnectorLockFailure',
                'EVCommunicationError',
                'GroundFailure',
                'HighTemperature',
                'InternalError',
                'OtherError',
                'OverCurrentFailure',
                'OverVoltage',
                'PowerMeterFailure',
                'PowerSwitchFailure',
                'ReaderFailure',
                'ResetFailure',
                'UnderVoltage',
                'WeakSignal',
            ])
            .default('OtherError'),
        clearAfterSeconds: z.number().int().nonnegative().optional(),
    });

    const RebootBody = z.object({ type: z.enum(['Soft', 'Hard']) });

    app.post<{ Params: { id: string } }>('/api/devices/:id/actions/plug-in', async (req, reply) => {
        const body = ConnectorIdBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        try {
            await sim.plugIn(body.data.connectorId);
            return { ok: true };
        } catch (err) {
            return reply.code(409).send({ error: (err as Error).message });
        }
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/actions/plug-out', async (req, reply) => {
        const body = ConnectorIdBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        try {
            await sim.plugOut(body.data.connectorId);
            return { ok: true };
        } catch (err) {
            return reply.code(500).send({ error: (err as Error).message });
        }
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/actions/swipe', async (req, reply) => {
        const body = SwipeBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        try {
            const outcome = await sim.swipeCard(body.data.connectorId, body.data.idTag);
            return { ok: true, outcome };
        } catch (err) {
            return reply.code(500).send({ error: (err as Error).message });
        }
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/actions/fault', async (req, reply) => {
        const body = FaultBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        try {
            await sim.injectFault(body.data);
            return { ok: true };
        } catch (err) {
            return reply.code(500).send({ error: (err as Error).message });
        }
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/actions/clear-fault', async (req, reply) => {
        const body = ConnectorIdBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        try {
            await sim.clearFault(body.data.connectorId);
            return { ok: true };
        } catch (err) {
            return reply.code(500).send({ error: (err as Error).message });
        }
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/actions/emergency-stop', async (req, reply) => {
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        try {
            await sim.emergencyStop();
            return { ok: true };
        } catch (err) {
            return reply.code(500).send({ error: (err as Error).message });
        }
    });

    /** Operator-controlled offline mode. Distinct from a network blip:
     *  this stays offline (auto-reconnect suppressed) until /reconnect
     *  is called. Used to exercise the offline transaction queue. */
    app.post<{ Params: { id: string } }>('/api/devices/:id/actions/disconnect', async (req, reply) => {
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        sim.forceOffline();
        return { ok: true, forcedOffline: true };
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/actions/reconnect', async (req, reply) => {
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        sim.goOnline();
        return { ok: true, forcedOffline: false };
    });

    /** Download a diagnostics archive that was produced by a prior
     *  GetDiagnostics CALL. The filename is the value the CP returned
     *  in the CALLRESULT. Path-traversal attempts are rejected — the
     *  filename must match the simulator's naming pattern. */
    app.get<{ Params: { id: string; filename: string } }>(
        '/api/devices/:id/diagnostics/:filename',
        async (req, reply) => {
            const { id, filename } = req.params;
            if (!/^diagnostics-[A-Za-z0-9_-]+-\d+\.json\.gz$/.test(filename)) {
                return reply.code(400).send({ error: 'invalid filename' });
            }
            const dbDir = pathDirname(resolvePath(process.env.DB_PATH ?? './data/sim.sqlite'));
            const filePath = resolvePath(dbDir, 'diagnostics', id, filename);
            const { stat, readFile } = await import('node:fs/promises');
            try {
                await stat(filePath);
            } catch {
                return reply.code(404).send({ error: 'not found' });
            }
            const body = await readFile(filePath);
            reply.header('content-type', 'application/gzip');
            reply.header('content-disposition', `attachment; filename="${filename}"`);
            return reply.send(body);
        },
    );

    /**
     * List installed SmartCharging profiles for a device. Read-only;
     * profile install/clear is CSMS-driven by design.
     */
    app.get<{ Params: { id: string } }>('/api/devices/:id/charging-profiles', async (req, reply) => {
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        return store.listChargingProfiles(req.params.id);
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/actions/reboot', async (req, reply) => {
        const body = RebootBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        try {
            await sim.reboot(body.data.type);
            return { ok: true };
        } catch (err) {
            return reply.code(500).send({ error: (err as Error).message });
        }
    });

    // ---- FLEET OPERATIONS ----
    //
    // Coarse-grained, multi-device commands. Each loops over the
    // currently-spawned Simulator pool. None of these touch persistent
    // device rows — they exercise live runtime state.

    const StartFractionBody = z.object({
        fraction: z.number().min(0).max(1),
        idTag: z.string().min(1).max(20).default('TEST-TAG-001'),
    });

    app.post('/api/fleet/start', async (req, reply) => {
        const body = StartFractionBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });

        // Build the eligible-connector pool: online device, connector
        // Available, no active transaction, operative. Sample randomly
        // up to the requested fraction to spread load realistically.
        type Target = { sim: ReturnType<typeof manager.get>; connectorId: number };
        const targets: Target[] = [];
        for (const sim of manager.list()) {
            const snap = sim.snapshot();
            if (!snap.online) continue;
            for (const c of snap.connectors) {
                if (c.status === 'Available' && c.transactionId === null) {
                    targets.push({ sim, connectorId: c.id });
                }
            }
        }
        // Fisher–Yates shuffle so the picked subset is random.
        for (let i = targets.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [targets[i], targets[j]] = [targets[j]!, targets[i]!];
        }
        const want = Math.floor(targets.length * body.data.fraction);
        const picked = targets.slice(0, want);

        let started = 0;
        const errors: string[] = [];
        for (const t of picked) {
            try {
                if (!t.sim) continue;
                const sessionRowId = store.insertSession({
                    deviceId: t.sim.device.id,
                    connectorId: t.connectorId,
                    transactionId: 0,
                    idTag: body.data.idTag,
                    status: 'active',
                    startedAt: new Date().toISOString(),
                    endedAt: null,
                    endReason: null,
                    energyWh: 0,
                    peakPowerKw: 0,
                });
                const txId = await t.sim.startSession(t.connectorId, body.data.idTag, sessionRowId);
                store.db.prepare(`UPDATE sessions SET transaction_id = ? WHERE id = ?`).run(txId, sessionRowId);
                started++;
            } catch (err) {
                errors.push((err as Error).message);
            }
        }
        return { eligible: targets.length, picked: picked.length, started, errors: errors.slice(0, 10) };
    });

    app.post('/api/fleet/reconnect', async () => {
        const sims = manager.list();
        for (const sim of sims) {
            // Soft reboot is a clean disconnect → schedules its own
            // reconnect via OcppClient's backoff. Don't await — fire
            // them all in parallel so the test surfaces concurrency.
            sim.reboot('Soft').catch(() => undefined);
        }
        return { reconnecting: sims.length };
    });

    const HeartbeatIntervalBody = z.object({
        seconds: z.number().int().positive().max(86400),
    });

    app.post('/api/fleet/heartbeat-interval', async (req, reply) => {
        const body = HeartbeatIntervalBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        let updated = 0;
        for (const sim of manager.list()) {
            const status = sim.setOcppConfig('HeartbeatInterval', String(body.data.seconds));
            if (status === 'Accepted' || status === 'RebootRequired') updated++;
        }
        return { updated, seconds: body.data.seconds };
    });

    app.post('/api/fleet/emergency-stop', async () => {
        const sims = manager.list();
        await Promise.all(sims.map((sim) => sim.emergencyStop().catch(() => undefined)));
        return { stopped: sims.length };
    });

    /**
     * Stop every active session across the fleet without faulting the
     * connectors. Returns the number of sessions actually ended.
     * Distinct from /emergency-stop — this is the "graceful end" button.
     */
    app.post('/api/fleet/stop-all', async () => {
        const sims = manager.list();
        const counts = await Promise.all(sims.map((sim) => sim.stopAllSessions().catch(() => 0)));
        const sessions = counts.reduce((s, n) => s + n, 0);
        return { devices: sims.length, sessionsStopped: sessions };
    });

    /** Cheap rollup for the Fleet Ops dashboard header. */
    app.get('/api/fleet/summary', async () => {
        let total = 0;
        let online = 0;
        let charging = 0;
        let active_connectors = 0;
        for (const sim of manager.list()) {
            total++;
            const snap = sim.snapshot();
            if (snap.online) online++;
            for (const c of snap.connectors) {
                if (c.transactionId !== null) charging++;
                if (c.status !== 'Unavailable') active_connectors++;
            }
        }
        const queue = store.countPendingMessagesAll();
        return {
            total,
            online,
            offline: total - online,
            chargingConnectors: charging,
            activeConnectors: active_connectors,
            pendingMessages: queue.total,
            devicesWithPending: queue.devices,
        };
    });

    app.get('/api/sessions', async (req) => {
        const q = req.query as {
            status?: 'active' | 'completed' | 'aborted';
            deviceId?: string;
            idTag?: string;
            since?: string;
            until?: string;
            limit?: string;
            offset?: string;
        };
        const limit = Math.min(200, Math.max(1, q.limit ? Number(q.limit) : 50));
        const offset = Math.max(0, q.offset ? Number(q.offset) : 0);
        const filter = {
            status: q.status,
            deviceId: q.deviceId,
            idTag: q.idTag,
            since: q.since,
            until: q.until,
        };
        const sessions = store.listSessions({ ...filter, limit, offset });
        const total = store.countSessions(filter);
        return { sessions, total, limit, offset };
    });

    // ---- WEBSOCKET PUBSUB ----

    /** Frame actions that fire constantly during charging (MeterValues
     *  every 1–60s × N sessions; Heartbeat every 5min × N devices). The
     *  WS hub coalesces these — keeping only the latest per (device,
     *  action) inside the flush window — so a 200-device fleet doesn't
     *  push hundreds of messages per second to every browser. Anything
     *  not on this list passes through immediately on the next flush. */
    const COALESCE_FRAME_ACTIONS = new Set(['MeterValues', 'Heartbeat']);
    const FLUSH_MS = 100;

    app.register(async (instance) => {
        instance.get('/api/ws', { websocket: true }, (socket) => {
            const send = (msg: unknown) => {
                if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
            };
            send({
                type: 'hello',
                devices: store.listDevices().map((d) => withRuntime(d, manager, store)),
            });

            // Per-connection coalescing buffers. Flushed on a 100ms
            // timer — 10 batches/sec is plenty for any live UI, and
            // each browser tab caps out at that rate regardless of
            // fleet size.
            const tickBuffer = new Map<string, unknown>(); // key: deviceId:connectorId
            const frameBuffer: unknown[] = [];
            const coalescedFrames = new Map<string, unknown>(); // key: deviceId:action
            const droppedByDevice = new Map<string, number>();

            const flush = (): void => {
                if (tickBuffer.size > 0) {
                    for (const payload of tickBuffer.values()) send({ type: 'tick', payload });
                    tickBuffer.clear();
                }
                if (frameBuffer.length > 0) {
                    for (const payload of frameBuffer) send({ type: 'frame', payload });
                    frameBuffer.length = 0;
                }
                if (coalescedFrames.size > 0) {
                    for (const payload of coalescedFrames.values()) send({ type: 'frame', payload });
                    coalescedFrames.clear();
                }
                if (droppedByDevice.size > 0) {
                    let total = 0;
                    const byDevice: Record<string, number> = {};
                    for (const [id, count] of droppedByDevice) {
                        byDevice[id] = count;
                        total += count;
                    }
                    // `dropped` stays for back-compat with anything still
                    // reading the global field; new clients use byDevice
                    // to scope the indicator to the device a tab is on.
                    send({ type: 'frames-coalesced', dropped: total, byDevice });
                    droppedByDevice.clear();
                }
            };
            const flushTimer = setInterval(flush, FLUSH_MS);

            // State and session events are low-volume and the UI
            // depends on them landing immediately (online flips,
            // session start/stop) — pass through without coalescing.
            const onState = (e: unknown) => send({ type: 'state', payload: e });
            const onSession = (e: unknown) => send({ type: 'session', payload: e });

            const onTick = (e: unknown) => {
                const t = e as { deviceId: string; connectorId: number };
                tickBuffer.set(`${t.deviceId}:${t.connectorId}`, e);
            };

            const onFrame = (e: unknown) => {
                const f = e as { deviceId?: string; action?: string; direction?: string };
                const payload = { ...(e as object), at: Date.now() };
                if (f.action && COALESCE_FRAME_ACTIONS.has(f.action) && f.deviceId) {
                    // Key by direction too — otherwise the CSMS's CALLRESULT
                    // (direction=in) overwrites the CP's CALL (direction=out)
                    // within the 100ms flush window, hiding the originating
                    // send and making it look like the CSMS spontaneously
                    // sent Heartbeat/MeterValues.
                    const key = `${f.deviceId}:${f.direction ?? '?'}:${f.action}`;
                    if (coalescedFrames.has(key)) {
                        droppedByDevice.set(f.deviceId, (droppedByDevice.get(f.deviceId) ?? 0) + 1);
                    }
                    coalescedFrames.set(key, payload);
                } else {
                    frameBuffer.push(payload);
                }
            };

            const onQueueOverflow = (e: unknown) => send({ type: 'queue-overflow', payload: e });
            const onBenchmarkProgress = (e: unknown) => send({ type: 'benchmark', payload: e });
            const onBenchmarkDone = (e: unknown) => send({ type: 'benchmark-done', payload: e });
            manager.on('state', onState);
            manager.on('tick', onTick);
            manager.on('session', onSession);
            manager.on('frame', onFrame);
            manager.on('queueOverflow', onQueueOverflow);
            benchmarkBus.on('progress', onBenchmarkProgress);
            benchmarkBus.on('done', onBenchmarkDone);
            socket.on('close', () => {
                clearInterval(flushTimer);
                manager.off('state', onState);
                manager.off('tick', onTick);
                manager.off('session', onSession);
                manager.off('frame', onFrame);
                manager.off('queueOverflow', onQueueOverflow);
                benchmarkBus.off('progress', onBenchmarkProgress);
                benchmarkBus.off('done', onBenchmarkDone);
            });
        });
    });

    app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

    // Prometheus scrape endpoint. Internal-only, no auth — bind the
    // server to localhost or behind your network policy in production.
    app.get('/metrics', async (_req, reply) => {
        const body = await metricsRegistry.metrics();
        reply.header('Content-Type', metricsRegistry.contentType).send(body);
    });

    // ---- CONFORMANCE ----
    //
    // Lists the bundled OCPP cases and runs the suite against a fresh
    // pair of MockCsms + Simulator instances per case. The conformance
    // package depends on @ocpp-sim/server, so we import it lazily here
    // to keep the runtime cycle from biting at module init.

    app.get('/api/conformance/cases', async () => {
        const { ALL_CASES } = await import('@ocpp-sim/conformance');
        return {
            cases: ALL_CASES.map((c) => ({ id: c.id, title: c.title, profile: c.profile })),
        };
    });

    app.post('/api/conformance/run', async () => {
        const { ALL_CASES, runConformanceSuite } = await import('@ocpp-sim/conformance');
        return runConformanceSuite(ALL_CASES);
    });

    // ---- APP SETTINGS ----
    //
    // App-wide preferences that aren't tied to a single device. Today
    // just the default OCPP gateway URL — when the user creates a new
    // device without specifying ocppUrl, it gets this value.

    app.get('/api/settings', async () => ({
        defaultOcppUrl: currentDefaultOcppUrl,
    }));

    const SettingsBody = z.object({
        defaultOcppUrl: z.string().url(),
    });

    app.put('/api/settings', async (req, reply) => {
        const body = SettingsBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        currentDefaultOcppUrl = body.data.defaultOcppUrl;
        store.setSetting('default_ocpp_url', currentDefaultOcppUrl);
        return { defaultOcppUrl: currentDefaultOcppUrl };
    });

    // ---- BENCHMARK RUNS ----
    //
    // POST /runs       start a scenario; returns the row id + initial state
    // POST /runs/:id/stop   stop a run early
    // GET  /runs       paginated history
    // GET  /runs/:id   single run with summary
    // GET  /presets    curated scenario presets

    app.get('/api/benchmark/presets', async () => {
        return SCENARIO_PRESETS;
    });

    app.get('/api/benchmark/runs', async (req) => {
        const q = req.query as { limit?: string; offset?: string };
        return store.listBenchmarkRuns({
            limit: q.limit ? Number(q.limit) : undefined,
            offset: q.offset ? Number(q.offset) : undefined,
        });
    });

    app.get<{ Params: { id: string } }>('/api/benchmark/runs/:id', async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid id' });
        const run = store.getBenchmarkRun(id);
        if (!run) return reply.code(404).send({ error: 'not found' });
        return run;
    });

    app.post('/api/benchmark/runs', async (req, reply) => {
        const body = ScenarioSchema.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const startedAt = new Date().toISOString();
        const runId = store.insertBenchmarkRun(body.data, startedAt);
        const engine = new BenchmarkEngine(runId, body.data, manager, store, currentDefaultOcppUrl);
        engine.on('progress', (p) => benchmarkBus.emit('progress', p));
        engine.on('done', (d) => {
            benchmarkBus.emit('done', d);
            activeRuns.delete(runId);
        });
        engine.on('error', (err) => {
            // Engine surface — engine itself counts these in its summary.
            // Keep noise down.
            void err;
        });
        activeRuns.set(runId, engine);
        try {
            await engine.start();
        } catch (err) {
            activeRuns.delete(runId);
            return reply.code(500).send({ error: (err as Error).message });
        }
        const run = store.getBenchmarkRun(runId);
        return run;
    });

    app.post<{ Params: { id: string } }>('/api/benchmark/runs/:id/stop', async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid id' });
        const engine = activeRuns.get(id);
        if (!engine) return reply.code(404).send({ error: 'run not active' });
        await engine.stop();
        return { ok: true };
    });

    /**
     * Wipe the simulator: tear down every Simulator, truncate every
     * SQLite table, and zero in-process state. The body must include
     * `confirm: 'DELETE'` so this endpoint can't fire by accident.
     * Returns 200 with `{ ok, devices: 0 }` on success.
     */
    const ResetBody = z.object({ confirm: z.literal('DELETE') });

    app.post('/api/settings/reset', async (req, reply) => {
        const body = ResetBody.safeParse(req.body);
        if (!body.success) {
            return reply.code(400).send({
                error: 'reset requires `confirm: "DELETE"` in the body',
            });
        }
        await manager.stopAll();
        store.reset();
        // Fan a synthetic 'state' so any open WS clients refetch their device lists.
        manager.emit('state', { deviceId: '__reset__', online: false });
        return { ok: true, devices: 0 };
    });

    // ---- STATIC WEB BUNDLE (production) ----
    //
    // Registered last so /api/* and /metrics route handlers match
    // first. Falls back to index.html for any GET that doesn't match
    // a static asset — that's the SPA-fallback behavior react-router
    // needs for deep links to /devices/:id, /benchmark/runs/:id, etc.
    if (webDistDir) {
        const root = resolvePath(webDistDir);
        await app.register(fastifyStatic, {
            root,
            prefix: '/',
            wildcard: false,
        });
        app.setNotFoundHandler((req, reply) => {
            // Don't SPA-fallback for /api/* — those should 404 cleanly.
            const url = req.url ?? '';
            if (url.startsWith('/api/') || url === '/metrics') {
                reply.code(404).send({ error: 'not found' });
                return;
            }
            reply.sendFile('index.html');
        });
    }

    return app;
}

function withRuntime(d: Device, mgr: DeviceManager, store: Store) {
    const sim = mgr.get(d.id);
    const snap = sim?.snapshot();
    // Strip authPassword from the wire response — it's a shared secret.
    // Surface only whether one is set so the UI can show "configured".
    const { authPassword, ...safe } = d;
    return {
        ...safe,
        hasAuthPassword: Boolean(authPassword),
        online: snap?.online ?? false,
        connectors: snap?.connectors ?? defaultConnectors(d),
        pendingQueueDepth: store.countPendingMessages(d.id),
    };
}

function defaultConnectors(d: Device) {
    const n = d.type === 'DC' ? 2 : 1;
    return Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        status: 'Available' as const,
        transactionId: null,
    }));
}
