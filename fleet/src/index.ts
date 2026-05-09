/**
 * Fleet manager entry point.
 *
 * MR-D: Express + supervisor + in-memory registry.
 * MR-E adds: SQLite persistence (`FLEET_DB_PATH`, default
 * `./fleet.sqlite`); boot-from-snapshot re-spawns every persisted
 * CP; orphaned active sessions are flipped to `aborted` with
 * `end_reason='manager_restart'`. Dev reset endpoint is gated by
 * `EVEYS_FLEET_DEV_RESET=1`.
 */

import express from 'express';
import cors from 'cors';
import { Registry } from './registry';
import { WorkerSupervisor } from './supervisor';
import { createFleetRouter, bootstrapFromStore } from './api';
import { FleetStore } from './sqlite';

const PORT = Number(process.env.FLEET_PORT ?? 3100);
const DEFAULT_OCPP_URL = process.env.FLEET_OCPP_URL ?? 'ws://localhost:19000';
const DB_PATH = process.env.FLEET_DB_PATH ?? './fleet.sqlite';
const DEV_RESET_ENABLED = process.env.EVEYS_FLEET_DEV_RESET === '1';

const store = new FleetStore(DB_PATH);
const registry = new Registry();
const supervisor = new WorkerSupervisor({ registry, store });

const app = express();
app.use(cors());
app.use(express.json());
app.use('/fleet', createFleetRouter({
    registry,
    supervisor,
    store,
    defaultOcppUrl: DEFAULT_OCPP_URL,
    devResetEnabled: DEV_RESET_ENABLED,
}));

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', cps: registry.list().length });
});

const server = app.listen(PORT, () => {
    console.log(`[fleet] manager listening on :${PORT}`);
    console.log(`[fleet] default OCPP URL: ${DEFAULT_OCPP_URL}`);
    console.log(`[fleet] sqlite: ${DB_PATH}`);
    if (DEV_RESET_ENABLED) {
        console.warn('[fleet] DEV RESET enabled — POST /fleet/_dev/reset will wipe state');
    }
    const { spawned, aborted_sessions } = bootstrapFromStore({ store, supervisor, defaultOcppUrl: DEFAULT_OCPP_URL });
    if (spawned > 0 || aborted_sessions > 0) {
        console.log(`[fleet] bootstrap: respawned ${spawned} CPs from SQLite; aborted ${aborted_sessions} orphaned sessions`);
    }
});

const shutdown = async (signal: string): Promise<void> => {
    console.log(`[fleet] ${signal} received, shutting down`);
    await supervisor.shutdown();
    store.close();
    server.close(() => {
        console.log('[fleet] HTTP server closed');
        process.exit(0);
    });
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
