import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './api.js';
import { DeviceManager } from './device-manager.js';
import { Store } from './store.js';

const setup = async () => {
    const store = new Store(':memory:');
    const manager = new DeviceManager(store);
    manager.on('errored', () => undefined);
    const app = await buildServer({
        store,
        manager,
        defaultOcppUrl: 'ws://127.0.0.1:1',
        authToken: null,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected address info');
    const base = `http://127.0.0.1:${addr.port}`;
    return { app, base, manager, store };
};

describe('conformance REST', () => {
    let cleanup: (() => Promise<void>) | null = null;
    afterEach(async () => {
        if (cleanup) await cleanup();
        cleanup = null;
    });

    it('GET /api/conformance/cases returns the case index', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await app.close();
            store.close();
        };
        const r = (await fetch(`${base}/api/conformance/cases`).then((r) => r.json())) as {
            cases: Array<{ id: string; title: string; profile: string }>;
        };
        expect(Array.isArray(r.cases)).toBe(true);
        expect(r.cases.length).toBeGreaterThanOrEqual(20);
        // Spot-check the must-have field shape — anything else and the
        // SPA renderer breaks silently.
        for (const c of r.cases) {
            expect(typeof c.id).toBe('string');
            expect(typeof c.title).toBe('string');
            expect(typeof c.profile).toBe('string');
        }
    });

    // The full POST /api/conformance/run takes ~1.4s — runs every case
    // via real MockCsms + Simulator pairs. Worth covering once because
    // it's the load-bearing endpoint, but keep it tagged so it can be
    // skipped if the suite gets long.
    it('POST /api/conformance/run executes the suite and reports counts', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await app.close();
            store.close();
        };
        const r = (await fetch(`${base}/api/conformance/run`, { method: 'POST' }).then((r) =>
            r.json(),
        )) as {
            passed: number;
            failed: number;
            durationMs: number;
            cases: Array<{ id: string; status: 'passed' | 'failed'; error: string | null }>;
        };
        expect(r.passed + r.failed).toBe(r.cases.length);
        expect(r.cases.length).toBeGreaterThanOrEqual(20);
        expect(r.durationMs).toBeGreaterThan(0);
        // All bundled cases pass against the simulator. If this regresses
        // we want to know.
        expect(r.failed).toBe(0);
    }, 30_000);
});
