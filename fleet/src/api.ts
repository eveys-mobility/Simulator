/**
 * Fleet manager REST API.
 *
 * MR-D scope: CP CRUD + per-CP actions. Groups, sessions list,
 * load-balancing endpoints, dev-reset all land in MR-E/F.
 */

import express, { Request, Response, Router } from 'express';
import { Registry } from './registry';
import { generateCPId } from './registry';
import { WorkerSupervisor, SpawnSpec } from './supervisor';
import { CPType, PhaseMode, DCBatteryProfile, DownMessage } from './protocol';

interface CreateCPBody {
    cp_id?: string;
    display_name?: string;
    type?: CPType;
    ocpp_url?: string;
    phase_mode?: PhaseMode;
    dc_profile?: DCBatteryProfile;
    max_power_kw?: number;
}

export function createFleetRouter(args: {
    registry: Registry;
    supervisor: WorkerSupervisor;
    defaultOcppUrl: string;
}): Router {
    const router = express.Router();
    const { registry, supervisor, defaultOcppUrl } = args;

    router.get('/cps', (_req: Request, res: Response) => {
        res.json({ success: true, cps: registry.list() });
    });

    router.get('/cps/:cp_id', (req: Request, res: Response) => {
        const cp = registry.get(req.params.cp_id);
        if (!cp) return res.status(404).json({ success: false, error: 'not_found' });
        return res.json({ success: true, cp });
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
        const spec: SpawnSpec = {
            cp_id,
            display_name: body.display_name ?? cp_id,
            type: body.type,
            ocpp_url: body.ocpp_url ?? defaultOcppUrl,
            phase_mode: body.phase_mode,
            dc_profile: body.dc_profile,
            max_power_kw: body.max_power_kw,
        };
        try {
            supervisor.spawn(spec);
        } catch (err) {
            return res.status(500).json({ success: false, error: (err as Error).message });
        }
        const record = registry.get(cp_id);
        return res.status(201).json({ success: true, cp: record });
    });

    router.delete('/cps/:cp_id', async (req: Request, res: Response) => {
        const cp_id = req.params.cp_id;
        if (!registry.get(cp_id)) {
            return res.status(404).json({ success: false, error: 'not_found' });
        }
        await supervisor.terminate(cp_id);
        return res.json({ success: true });
    });

    // ------- per-CP actions -------

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

    return router;
}
