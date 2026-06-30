import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './api.js';
import { DeviceManager } from './device-manager.js';
import { Store } from './store.js';

/**
 * REST surface for per-device OCPP configuration. Mirrors what a CSMS
 * sees over GetConfiguration / ChangeConfiguration, but enriched with
 * per-key spec metadata for UI use.
 */

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ConfigKey {
    key: string;
    value: string;
    readonly: boolean;
    type: 'string' | 'int' | 'bool' | 'csl';
    default: string;
    rebootRequired: boolean;
    description: string | null;
}

describe('per-device OCPP config endpoints', () => {
    let cleanup: (() => Promise<void>) | null = null;
    afterEach(async () => {
        if (cleanup) await cleanup();
        cleanup = null;
    });

    it('GET /api/devices/:id/config returns enriched keys', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = (await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json())) as { id: string };

        const cfg = (await fetch(`${base}/api/devices/${created.id}/config`).then((r) =>
            r.json(),
        )) as {
            keys: ConfigKey[];
        };
        expect(cfg.keys.length).toBeGreaterThan(20);
        // Spot-check a known writable key.
        const hb = cfg.keys.find((k) => k.key === 'HeartbeatInterval');
        expect(hb).toBeDefined();
        expect(hb?.readonly).toBe(false);
        expect(hb?.type).toBe('int');
        // And a known read-only key.
        const numConn = cfg.keys.find((k) => k.key === 'NumberOfConnectors');
        expect(numConn?.readonly).toBe(true);
        expect(numConn?.value).toBe('1'); // AC = single connector
    });

    it('PUT writes a value and returns Accepted', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = (await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json())) as { id: string };

        const r = await fetch(`${base}/api/devices/${created.id}/config/HeartbeatInterval`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value: '120' }),
        }).then((r) => r.json() as Promise<{ status: string; value: string }>);
        expect(r.status).toBe('Accepted');
        expect(r.value).toBe('120');

        // Re-read to confirm persistence.
        const cfg = (await fetch(`${base}/api/devices/${created.id}/config`).then((r) =>
            r.json(),
        )) as {
            keys: ConfigKey[];
        };
        expect(cfg.keys.find((k) => k.key === 'HeartbeatInterval')?.value).toBe('120');
    });

    it('PUT on a read-only key returns Rejected and does not change the value', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = (await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json())) as { id: string };

        const r = await fetch(`${base}/api/devices/${created.id}/config/NumberOfConnectors`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value: '99' }),
        }).then((r) => r.json() as Promise<{ status: string; value: string }>);
        expect(r.status).toBe('Rejected');
        expect(r.value).toBe('1'); // unchanged
    });

    it('PUT on an unknown key returns NotSupported', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = (await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json())) as { id: string };

        const r = await fetch(`${base}/api/devices/${created.id}/config/BogusKey`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value: 'whatever' }),
        }).then((r) => r.json() as Promise<{ status: string }>);
        expect(r.status).toBe('NotSupported');
    });

    it('PUT with a bad type returns Rejected (type validation)', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = (await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json())) as { id: string };

        // HeartbeatInterval is int; "abc" fails parse.
        const r = await fetch(`${base}/api/devices/${created.id}/config/HeartbeatInterval`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value: 'abc' }),
        }).then((r) => r.json() as Promise<{ status: string }>);
        expect(r.status).toBe('Rejected');
    });

    it('GET on an unknown device returns 404', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const r = await fetch(`${base}/api/devices/nope/config`);
        expect(r.status).toBe(404);
    });

    it('PUT bulk applies every change independently and returns per-key status', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = (await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json())) as { id: string };

        const r = await fetch(`${base}/api/devices/${created.id}/config`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                changes: {
                    HeartbeatInterval: '90',
                    AuthorizeRemoteTxRequests: 'true',
                    NumberOfConnectors: '99', // read-only → Rejected
                    BogusKey: 'whatever', // unknown → NotSupported
                    MeterValueSampleInterval: 'not-a-number', // bad type → Rejected
                },
            }),
        }).then(
            (r) =>
                r.json() as Promise<{
                    results: Array<{ key: string; status: string; value: string }>;
                }>,
        );

        // Map results by key for easier assertion.
        const byKey = Object.fromEntries(r.results.map((x) => [x.key, x]));
        expect(byKey.HeartbeatInterval?.status).toBe('Accepted');
        expect(byKey.HeartbeatInterval?.value).toBe('90');
        expect(byKey.AuthorizeRemoteTxRequests?.status).toBe('Accepted');
        expect(byKey.AuthorizeRemoteTxRequests?.value).toBe('true');
        expect(byKey.NumberOfConnectors?.status).toBe('Rejected');
        expect(byKey.NumberOfConnectors?.value).toBe('1'); // unchanged
        expect(byKey.BogusKey?.status).toBe('NotSupported');
        expect(byKey.MeterValueSampleInterval?.status).toBe('Rejected');

        // Persisted state matches the Accepted writes only.
        const cfg = (await fetch(`${base}/api/devices/${created.id}/config`).then((r) =>
            r.json(),
        )) as { keys: Array<{ key: string; value: string }> };
        expect(cfg.keys.find((k) => k.key === 'HeartbeatInterval')?.value).toBe('90');
        expect(cfg.keys.find((k) => k.key === 'AuthorizeRemoteTxRequests')?.value).toBe('true');
        expect(cfg.keys.find((k) => k.key === 'MeterValueSampleInterval')?.value).toBe('60'); // default unchanged
    });

    it('PUT bulk on an unknown device returns 404', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const r = await fetch(`${base}/api/devices/nope/config`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ changes: { HeartbeatInterval: '60' } }),
        });
        expect(r.status).toBe(404);
    });

    it('PUT bulk preserves response order for the requested keys', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = (await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json())) as { id: string };

        const requestKeys = [
            'MeterValueSampleInterval',
            'HeartbeatInterval',
            'AuthorizeRemoteTxRequests',
            'LocalAuthorizeOffline',
        ];
        const changes: Record<string, string> = {
            MeterValueSampleInterval: '20',
            HeartbeatInterval: '180',
            AuthorizeRemoteTxRequests: 'true',
            LocalAuthorizeOffline: 'false',
        };
        const r = await fetch(`${base}/api/devices/${created.id}/config`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ changes }),
        }).then((r) => r.json() as Promise<{ results: Array<{ key: string }> }>);

        expect(r.results.map((x) => x.key)).toEqual(requestKeys);
    });

    it('PUT bulk with a malformed body returns 400', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = (await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json())) as { id: string };

        // 'changes' is required; non-string values are rejected.
        const r1 = await fetch(`${base}/api/devices/${created.id}/config`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(r1.status).toBe(400);

        const r2 = await fetch(`${base}/api/devices/${created.id}/config`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ changes: { HeartbeatInterval: 60 } }), // number, not string
        });
        expect(r2.status).toBe(400);
    });
});
