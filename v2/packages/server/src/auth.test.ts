import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './api.js';
import { DeviceManager } from './device-manager.js';
import { Store } from './store.js';

const setup = async (authToken: string | null) => {
    const store = new Store(':memory:');
    const manager = new DeviceManager(store);
    const app = await buildServer({
        store,
        manager,
        defaultOcppUrl: 'ws://localhost:1',
        authToken,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected address info');
    const base = `http://127.0.0.1:${addr.port}`;
    return { app, base, store };
};

describe('AUTH_TOKEN gate', () => {
    let cleanup: (() => Promise<void>) | null = null;
    afterEach(async () => {
        if (cleanup) await cleanup();
        cleanup = null;
    });

    it('without AUTH_TOKEN, every endpoint is open', async () => {
        const { app, base, store } = await setup(null);
        cleanup = async () => {
            await app.close();
            store.close();
        };
        const r = await fetch(`${base}/api/devices`);
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual([]);
    });

    it('with AUTH_TOKEN, /api/* requires the bearer token', async () => {
        const { app, base, store } = await setup('s3cret');
        cleanup = async () => {
            await app.close();
            store.close();
        };
        const noAuth = await fetch(`${base}/api/devices`);
        expect(noAuth.status).toBe(401);

        const wrong = await fetch(`${base}/api/devices`, {
            headers: { authorization: 'Bearer wrong' },
        });
        expect(wrong.status).toBe(401);

        const right = await fetch(`${base}/api/devices`, {
            headers: { authorization: 'Bearer s3cret' },
        });
        expect(right.status).toBe(200);
    });

    it('/api/health stays open even with AUTH_TOKEN set (probes need it)', async () => {
        const { app, base, store } = await setup('s3cret');
        cleanup = async () => {
            await app.close();
            store.close();
        };
        const r = await fetch(`${base}/api/health`);
        expect(r.status).toBe(200);
        const body = (await r.json()) as { ok: boolean };
        expect(body.ok).toBe(true);
    });

    it('/metrics is gated by AUTH_TOKEN when set', async () => {
        const { app, base, store } = await setup('s3cret');
        cleanup = async () => {
            await app.close();
            store.close();
        };
        const noAuth = await fetch(`${base}/metrics`);
        expect(noAuth.status).toBe(401);

        const right = await fetch(`${base}/metrics`, {
            headers: { authorization: 'Bearer s3cret' },
        });
        expect(right.status).toBe(200);
        expect(await right.text()).toMatch(/ocpp_call_total/);
    });
});
