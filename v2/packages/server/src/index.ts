import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildServer } from './api.js';
import { DeviceManager } from './device-manager.js';
import { Store } from './store.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const DB_PATH = resolve(process.env.DB_PATH ?? './data/sim.sqlite');
const OCPP_URL_ENV = process.env.OCPP_URL ?? 'ws://localhost:19000';

mkdirSync(dirname(DB_PATH), { recursive: true });
const store = new Store(DB_PATH);
const aborted = store.abortOrphanedSessions();
if (aborted) console.log(`[server] aborted ${aborted} orphaned active session(s) from prior run`);

// Resolve initial default OCPP URL: persisted setting (if any) wins,
// otherwise the env var, otherwise localhost. Subsequent edits via the
// /api/settings endpoint update only the persisted value.
const persistedUrl = store.getSetting('default_ocpp_url');
const initialOcppUrl = persistedUrl ?? OCPP_URL_ENV;

const manager = new DeviceManager(store);

// Re-spawn every device persisted in the DB at boot.
for (const d of store.listDevices()) {
    manager.spawn(d).catch((err) => console.error(`[server] failed to spawn ${d.id}:`, err));
}

const app = await buildServer({ store, manager, defaultOcppUrl: initialOcppUrl });

await app.listen({ port: PORT, host: HOST });
console.log(`[server] listening on http://${HOST}:${PORT}`);
console.log(`[server] db: ${DB_PATH}`);
console.log(`[server] default OCPP url: ${initialOcppUrl}`);

const shutdown = async () => {
    console.log('[server] shutting down…');
    await manager.stopAll();
    await app.close();
    store.close();
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
