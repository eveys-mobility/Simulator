import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
    DCBatteryProfileSchema,
    DEVICE_DEFAULTS,
    type Device,
    DeviceTypeSchema,
    PhaseModeSchema,
} from '@ocpp-sim/core';
import Fastify from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import type { DeviceManager } from './device-manager.js';
import { registry as metricsRegistry } from './metrics.js';
import type { Store } from './store.js';

interface BuildArgs {
    store: Store;
    manager: DeviceManager;
    defaultOcppUrl: string;
}

export async function buildServer({ store, manager, defaultOcppUrl }: BuildArgs) {
    const app = Fastify({ logger: { level: 'info' } });
    await app.register(cors, { origin: true });
    await app.register(websocket);

    // Mutable so the Settings PUT can update what new devices default to.
    let currentDefaultOcppUrl = defaultOcppUrl;

    // ---- DEVICES ----

    const CreateDeviceBody = z.object({
        type: DeviceTypeSchema,
        displayName: z.string().min(1).max(80).optional(),
        maxPowerKw: z.number().positive().optional(),
        ocppUrl: z.string().url().optional(),
        phaseMode: PhaseModeSchema.optional(),
        dcProfile: DCBatteryProfileSchema.partial().optional(),
    });

    app.get('/api/devices', async () => {
        const devices = store.listDevices();
        return devices.map((d) => withRuntime(d, manager));
    });

    app.post('/api/devices', async (req, reply) => {
        const body = CreateDeviceBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const id = `cp_${uuid().slice(0, 8)}`;
        const defaults = DEVICE_DEFAULTS[body.data.type];
        const device: Device = {
            id,
            displayName: body.data.displayName ?? `${body.data.type} ${id}`,
            type: body.data.type,
            model: defaults.model,
            vendor: 'Eveys',
            firmwareVersion: '1.0.0',
            maxPowerKw: body.data.maxPowerKw ?? defaults.maxPowerKw,
            ocppUrl: body.data.ocppUrl ?? currentDefaultOcppUrl,
            phaseMode: body.data.phaseMode ?? 'balanced',
            dcProfile:
                body.data.type === 'DC'
                    ? { ...DCBatteryProfileSchema.parse({ capacityKwh: 60, chargerMaxKw: defaults.maxPowerKw }), ...body.data.dcProfile }
                    : undefined,
            createdAt: new Date().toISOString(),
        };
        store.insertDevice(device);
        await manager.spawn(device);
        return withRuntime(device, manager);
    });

    app.get<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
        const d = store.getDevice(req.params.id);
        if (!d) return reply.code(404).send({ error: 'not found' });
        return withRuntime(d, manager);
    });

    const PatchDeviceBody = z.object({
        displayName: z.string().min(1).max(80).optional(),
        vendor: z.string().min(1).max(80).optional(),
        firmwareVersion: z.string().min(1).max(40).optional(),
        maxPowerKw: z.number().positive().max(1000).optional(),
        ocppUrl: z.string().url().optional(),
        phaseMode: PhaseModeSchema.optional(),
        dcProfile: DCBatteryProfileSchema.partial().optional(),
    });

    /** Editing any of these requires reconnecting the OCPP socket so
     *  the gateway sees the new BootNotification. We refuse the edit
     *  if a session is active rather than yanking it mid-charge. */
    const RESPAWN_FIELDS = ['vendor', 'firmwareVersion', 'maxPowerKw', 'ocppUrl'] as const;

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

        // Model string is derived from type + maxPowerKw so BootNotification
        // matches the active config (the gateway sees `Eveys-22kW-AC` etc.).
        const maxPowerKw = body.data.maxPowerKw ?? existing.maxPowerKw;
        const model =
            body.data.maxPowerKw !== undefined
                ? `Eveys-${Math.round(maxPowerKw)}kW-${existing.type}`
                : existing.model;

        const merged: Device = {
            ...existing,
            displayName: body.data.displayName ?? existing.displayName,
            vendor: body.data.vendor ?? existing.vendor,
            firmwareVersion: body.data.firmwareVersion ?? existing.firmwareVersion,
            maxPowerKw,
            model,
            ocppUrl: body.data.ocppUrl ?? existing.ocppUrl,
            phaseMode: body.data.phaseMode ?? existing.phaseMode,
            dcProfile: mergedDcProfile,
        };

        store.updateDevice(req.params.id, {
            displayName: merged.displayName,
            vendor: merged.vendor,
            firmwareVersion: merged.firmwareVersion,
            maxPowerKw: merged.maxPowerKw,
            ocppUrl: merged.ocppUrl,
            phaseMode: merged.phaseMode,
            dcProfile: merged.dcProfile,
        });
        // Model lives in the same row but isn't in the patch type (clients
        // can't set it directly). Update it via raw SQL when it changed.
        if (model !== existing.model) {
            store.db.prepare(`UPDATE devices SET model = ? WHERE id = ?`).run(model, req.params.id);
        }

        if (changedRespawnFields.length > 0) {
            await manager.respawn(merged);
        }
        return withRuntime(merged, manager);
    });

    app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
        await manager.despawn(req.params.id);
        const removed = store.deleteDevice(req.params.id);
        if (!removed) return reply.code(404).send({ error: 'not found' });
        return reply.code(204).send();
    });

    // ---- SESSIONS ----

    const StartSessionBody = z.object({
        connectorId: z.number().int().positive(),
        idTag: z.string().min(1).default('TEST-TAG-001'),
    });

    app.post<{ Params: { id: string } }>('/api/devices/:id/sessions', async (req, reply) => {
        const body = StartSessionBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: body.error.message });
        const sim = manager.get(req.params.id);
        if (!sim) return reply.code(404).send({ error: 'device not found' });
        if (!sim.snapshot().online) return reply.code(409).send({ error: 'device offline' });

        // Persist the session row first so we have an id to thread through.
        const sessionRowId = store.insertSession({
            deviceId: req.params.id,
            connectorId: body.data.connectorId,
            transactionId: 0, // placeholder; updated below would require an updateSession() but we don't expose tx id at row level — keep 0 then patch via SQL if needed
            idTag: body.data.idTag,
            status: 'active',
            startedAt: new Date().toISOString(),
            endedAt: null,
            endReason: null,
            energyWh: 0,
            peakPowerKw: 0,
        });
        try {
            const transactionId = await sim.startSession(body.data.connectorId, body.data.idTag, sessionRowId);
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
            const result = await sim.stopSession(body.data.connectorId, body.data.reason);
            store.endSession({
                id: result.sessionRowId,
                endedAt: new Date().toISOString(),
                endReason: body.data.reason,
                energyWh: result.energyWh,
                peakPowerKw: result.peakPowerKw,
            });
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

    app.get('/api/sessions', async (req) => {
        const q = req.query as { status?: 'active' | 'completed' | 'aborted'; deviceId?: string; limit?: string };
        return store.listSessions({
            status: q.status,
            deviceId: q.deviceId,
            limit: q.limit ? Number(q.limit) : undefined,
        });
    });

    // ---- WEBSOCKET PUBSUB ----

    app.register(async (instance) => {
        instance.get('/api/ws', { websocket: true }, (socket) => {
            const send = (msg: unknown) => {
                if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
            };
            send({
                type: 'hello',
                devices: store.listDevices().map((d) => withRuntime(d, manager)),
            });
            const onState = (e: unknown) => send({ type: 'state', payload: e });
            const onTick = (e: unknown) => send({ type: 'tick', payload: e });
            const onSession = (e: unknown) => send({ type: 'session', payload: e });
            manager.on('state', onState);
            manager.on('tick', onTick);
            manager.on('session', onSession);
            socket.on('close', () => {
                manager.off('state', onState);
                manager.off('tick', onTick);
                manager.off('session', onSession);
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

    return app;
}

function withRuntime(d: Device, mgr: DeviceManager) {
    const sim = mgr.get(d.id);
    const snap = sim?.snapshot();
    return {
        ...d,
        online: snap?.online ?? false,
        connectors: snap?.connectors ?? defaultConnectors(d),
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
