/**
 * Fleet manager REST API.
 *
 * MR-D scope: CP CRUD + per-CP actions.
 * MR-E adds: groups CRUD, SQLite-backed CP/session persistence,
 *            sessions GET, dev-reset endpoint behind env flag.
 */

import express, { Request, Response, Router } from 'express';
import { Registry, generateCPId } from './registry';
import { WorkerSupervisor, SpawnSpec } from './supervisor';
import { CPType, PhaseMode, DCBatteryProfile, DownMessage } from './protocol';
import { FleetStore, parseDCProfile, LbStrategy, SessionStatus } from './sqlite';

interface CreateCPBody {
    cp_id?: string;
    display_name?: string;
    type?: CPType;
    ocpp_url?: string;
    phase_mode?: PhaseMode;
    dc_profile?: DCBatteryProfile;
    max_power_kw?: number;
    group_id?: number | null;
}

interface CreateGroupBody {
    name?: string;
    type?: CPType;
    lb_strategy?: LbStrategy;
    lb_enabled?: boolean;
}

export function createFleetRouter(args: {
    registry: Registry;
    supervisor: WorkerSupervisor;
    store: FleetStore;
    defaultOcppUrl: string;
    devResetEnabled: boolean;
}): Router {
    const router = express.Router();
    const { registry, supervisor, store, defaultOcppUrl, devResetEnabled } = args;

    // ---- charge points ----

    router.get('/cps', (_req: Request, res: Response) => {
        // Merge runtime registry rows with the SQLite group_id column
        // so the API always returns the persisted group attribution.
        const persisted = new Map(store.listCPs().map((r) => [r.cp_id, r]));
        const cps = registry.list().map((r) => ({
            ...r,
            group_id: persisted.get(r.cp_id)?.group_id ?? null,
        }));
        res.json({ success: true, cps });
    });

    router.get('/cps/:cp_id', (req: Request, res: Response) => {
        const cp = registry.get(req.params.cp_id);
        if (!cp) return res.status(404).json({ success: false, error: 'not_found' });
        const row = store.getCP(req.params.cp_id);
        return res.json({ success: true, cp: { ...cp, group_id: row?.group_id ?? null } });
    });

    router.post('/cps', (req: Request, res: Response) => {
        const body = req.body as CreateCPBody;
        if (body.type !== 'AC' && body.type !== 'DC') {
            return res.status(400).json({ success: false, error: 'type must be AC or DC' });
        }
        const cp_id = body.cp_id ?? generateCPId();
        if (registry.get(cp_id)) {
            return res.status(409).json({ success: false, error: `cp ${cp_id} already exists` });
        }
        if (body.group_id != null) {
            const g = store.getGroup(body.group_id);
            if (!g) return res.status(400).json({ success: false, error: `group ${body.group_id} not found` });
            if (g.type !== body.type) return res.status(400).json({ success: false, error: `group type ${g.type} does not match cp type ${body.type}` });
        }

        const display_name = body.display_name ?? cp_id;
        const ocpp_url = body.ocpp_url ?? defaultOcppUrl;

        // Persist first, then spawn. Order matters: if the spawn
        // throws we want SQLite already cleaned up; if we spawned
        // first and the INSERT raced (e.g. unique constraint via
        // someone calling POST twice in parallel), we'd have a live
        // worker with no row. Try-catch wraps both.
        try {
            store.createCP({
                cp_id,
                display_name,
                type: body.type,
                group_id: body.group_id ?? null,
                phase_mode: body.phase_mode,
                dc_profile: body.dc_profile,
                max_power_kw: body.max_power_kw,
                ocpp_url,
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: `persist failed: ${(err as Error).message}` });
        }

        const spec: SpawnSpec = {
            cp_id,
            display_name,
            type: body.type,
            ocpp_url,
            phase_mode: body.phase_mode,
            dc_profile: body.dc_profile,
            max_power_kw: body.max_power_kw,
        };
        try {
            supervisor.spawn(spec);
        } catch (err) {
            // Spawn failed; back out the SQLite write so the persist
            // and runtime states stay consistent.
            store.deleteCP(cp_id);
            return res.status(500).json({ success: false, error: (err as Error).message });
        }
        const record = registry.get(cp_id);
        return res.status(201).json({ success: true, cp: { ...record, group_id: body.group_id ?? null } });
    });

    router.patch('/cps/:cp_id', (req: Request, res: Response) => {
        const cp_id = req.params.cp_id;
        const existing = store.getCP(cp_id);
        if (!existing) return res.status(404).json({ success: false, error: 'not_found' });
        const body = req.body as Partial<CreateCPBody>;
        if ('group_id' in body && body.group_id != null) {
            const g = store.getGroup(body.group_id);
            if (!g) return res.status(400).json({ success: false, error: `group ${body.group_id} not found` });
            if (g.type !== existing.type) return res.status(400).json({ success: false, error: `group type ${g.type} does not match cp type ${existing.type}` });
        }
        const updated = store.updateCP(cp_id, {
            display_name: body.display_name,
            group_id: 'group_id' in body ? body.group_id : undefined,
            phase_mode: body.phase_mode,
            dc_profile: body.dc_profile,
            max_power_kw: body.max_power_kw,
            ocpp_url: body.ocpp_url,
        });
        return res.json({ success: true, cp: updated });
    });

    router.delete('/cps/:cp_id', async (req: Request, res: Response) => {
        const cp_id = req.params.cp_id;
        if (!registry.get(cp_id) && !store.getCP(cp_id)) {
            return res.status(404).json({ success: false, error: 'not_found' });
        }
        await supervisor.terminate(cp_id);
        store.deleteCP(cp_id);
        return res.json({ success: true });
    });

    // ---- per-CP actions ----

    const sendOrFail = (cp_id: string, msg: DownMessage, res: Response): void => {
        if (!registry.get(cp_id)) {
            res.status(404).json({ success: false, error: 'not_found' });
            return;
        }
        const sent = supervisor.send(cp_id, msg);
        if (!sent) {
            res.status(503).json({ success: false, error: 'worker not running (transient)' });
            return;
        }
        res.json({ success: true });
    };

    router.post('/cps/:cp_id/actions/plug-in', (req: Request, res: Response) => {
        const { connector_id, id_tag } = req.body ?? {};
        if (typeof connector_id !== 'number' || typeof id_tag !== 'string') {
            return res.status(400).json({ success: false, error: 'connector_id (number) and id_tag (string) required' });
        }
        sendOrFail(req.params.cp_id, { type: 'plug_in', connector_id, id_tag }, res);
    });

    router.post('/cps/:cp_id/actions/start', (req: Request, res: Response) => {
        const { connector_id } = req.body ?? {};
        if (typeof connector_id !== 'number') {
            return res.status(400).json({ success: false, error: 'connector_id (number) required' });
        }
        sendOrFail(req.params.cp_id, { type: 'start_charging', connector_id }, res);
    });

    router.post('/cps/:cp_id/actions/stop', (req: Request, res: Response) => {
        const { connector_id, reason } = req.body ?? {};
        if (typeof connector_id !== 'number') {
            return res.status(400).json({ success: false, error: 'connector_id (number) required' });
        }
        sendOrFail(req.params.cp_id, { type: 'stop_charging', connector_id, reason }, res);
    });

    router.post('/cps/:cp_id/actions/plug-out', (req: Request, res: Response) => {
        const { connector_id } = req.body ?? {};
        if (typeof connector_id !== 'number') {
            return res.status(400).json({ success: false, error: 'connector_id (number) required' });
        }
        sendOrFail(req.params.cp_id, { type: 'plug_out', connector_id }, res);
    });

    router.post('/cps/:cp_id/actions/emergency-stop', (req: Request, res: Response) => {
        const { connector_id } = req.body ?? {};
        if (typeof connector_id !== 'number') {
            return res.status(400).json({ success: false, error: 'connector_id (number) required' });
        }
        sendOrFail(req.params.cp_id, { type: 'emergency_stop', connector_id }, res);
    });

    // ---- groups ----

    router.get('/groups', (_req: Request, res: Response) => {
        res.json({ success: true, groups: store.listGroups() });
    });

    router.get('/groups/:id', (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });
        const g = store.getGroup(id);
        if (!g) return res.status(404).json({ success: false, error: 'not_found' });
        return res.json({ success: true, group: g });
    });

    router.post('/groups', (req: Request, res: Response) => {
        const body = req.body as CreateGroupBody;
        if (!body.name) return res.status(400).json({ success: false, error: 'name required' });
        if (body.type !== 'AC' && body.type !== 'DC') {
            return res.status(400).json({ success: false, error: 'type must be AC or DC' });
        }
        if (body.lb_strategy && body.lb_strategy !== 'round_robin' && body.lb_strategy !== 'least_active') {
            return res.status(400).json({ success: false, error: 'lb_strategy must be round_robin or least_active' });
        }
        if (store.getGroupByName(body.name)) {
            return res.status(409).json({ success: false, error: `group ${body.name} already exists` });
        }
        try {
            const g = store.createGroup({
                name: body.name,
                type: body.type,
                lb_strategy: body.lb_strategy,
                lb_enabled: body.lb_enabled,
            });
            return res.status(201).json({ success: true, group: g });
        } catch (err) {
            return res.status(500).json({ success: false, error: (err as Error).message });
        }
    });

    router.patch('/groups/:id', (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });
        if (!store.getGroup(id)) return res.status(404).json({ success: false, error: 'not_found' });
        const body = req.body as Partial<CreateGroupBody>;
        const updated = store.updateGroup(id, {
            name: body.name,
            lb_strategy: body.lb_strategy,
            lb_enabled: body.lb_enabled,
        });
        return res.json({ success: true, group: updated });
    });

    router.delete('/groups/:id', (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });
        const ok = store.deleteGroup(id);
        if (!ok) return res.status(404).json({ success: false, error: 'not_found' });
        // SQLite's ON DELETE SET NULL has already cleared cp.group_id;
        // the runtime registry doesn't track group affiliation in MR-D
        // (that's an MR-F field), so nothing to patch in-memory yet.
        return res.json({ success: true });
    });

    // ---- sessions ----

    router.get('/sessions', (req: Request, res: Response) => {
        const status = req.query.status as SessionStatus | undefined;
        const cp_id = req.query.cp_id as string | undefined;
        const limit = req.query.limit ? Number(req.query.limit) : 100;
        const sessions = store.listSessions({ status, cp_id, limit });
        return res.json({ success: true, sessions });
    });

    // ---- dev reset (gated) ----

    router.post('/_dev/reset', async (_req: Request, res: Response) => {
        if (!devResetEnabled) {
            return res.status(403).json({ success: false, error: 'dev reset disabled; set EVEYS_FLEET_DEV_RESET=1 to enable' });
        }
        // Tear down every running worker, then wipe SQLite.
        console.warn('[fleet] DEV RESET invoked — terminating all workers and dropping SQLite tables');
        await supervisor.shutdown();
        store.reset();
        return res.json({ success: true, message: 'fleet reset; restart manager to bootstrap' });
    });

    return router;
}

/**
 * Reload persisted CPs from SQLite into the running supervisor.
 * Called on manager boot. Per-row failures are logged and skipped
 * — one bad row shouldn't sink the whole boot.
 *
 * Active sessions left over from the previous process are aborted
 * (they're orphaned by definition; the worker that owned them is
 * gone and we can't reconcile its stop). The `aborted` row carries
 * `end_reason='manager_restart'` so an operator sees the trail.
 */
export function bootstrapFromStore(args: {
    store: FleetStore;
    supervisor: WorkerSupervisor;
    defaultOcppUrl: string;
}): { spawned: number; aborted_sessions: number } {
    const { store, supervisor, defaultOcppUrl } = args;
    const aborted_sessions = store.abortOrphanedActiveSessions();

    let spawned = 0;
    for (const row of store.listCPs()) {
        try {
            supervisor.spawn({
                cp_id: row.cp_id,
                display_name: row.display_name,
                type: row.type,
                ocpp_url: row.ocpp_url ?? defaultOcppUrl,
                phase_mode: (row.phase_mode as PhaseMode | null) ?? undefined,
                dc_profile: parseDCProfile(row),
                max_power_kw: row.max_power_kw ?? undefined,
            });
            spawned += 1;
        } catch (err) {
            console.warn(`[fleet] skipping cp_id=${row.cp_id} on bootstrap: ${(err as Error).message}`);
        }
    }
    return { spawned, aborted_sessions };
}
