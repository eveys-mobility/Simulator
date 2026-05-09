/**
 * Fleet manager entry point.
 *
 * Boots Express + the WorkerSupervisor on a single port. UI / WS
 * pubsub / SQLite / load-balancing all land in later MRs; v1 just
 * proves the worker_threads + REST plumbing works against a real
 * gateway.
 */

import express from 'express';
import cors from 'cors';
import { Registry } from './registry';
import { WorkerSupervisor } from './supervisor';
import { createFleetRouter } from './api';

const PORT = Number(process.env.FLEET_PORT ?? 3100);
const DEFAULT_OCPP_URL = process.env.FLEET_OCPP_URL ?? 'ws://localhost:19000';

const registry = new Registry();
const supervisor = new WorkerSupervisor({ registry });

const app = express();
app.use(cors());
app.use(express.json());
app.use('/fleet', createFleetRouter({ registry, supervisor, defaultOcppUrl: DEFAULT_OCPP_URL }));

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', cps: registry.list().length });
});

const server = app.listen(PORT, () => {
    console.log(`[fleet] manager listening on :${PORT}`);
    console.log(`[fleet] default OCPP URL: ${DEFAULT_OCPP_URL}`);
});

const shutdown = async (signal: string): Promise<void> => {
    console.log(`[fleet] ${signal} received, shutting down`);
    await supervisor.shutdown();
    server.close(() => {
        console.log('[fleet] HTTP server closed');
        process.exit(0);
    });
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
