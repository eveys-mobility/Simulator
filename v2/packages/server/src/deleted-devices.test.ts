import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './api.js';
import { DeviceManager } from './device-manager.js';
import { Store } from './store.js';

/**
 * REST surface for the "trash bin": soft-deleted devices that the
 * Settings UI shows and lets the operator restore or purge.
 */

const setup = async () => {
    const store = new Store(':memory:');
    const manager = new DeviceManager(store);
    // The DeviceManager fires 'errored' when a respawn races a
    // teardown; attach a swallowing listener so the Vitest unhandled
    // rejection guard doesn't trip during test teardown.
    manager.on('errored', () => undefined);
    const app = await buildServer({
        store,
        manager,
        defaultOcppUrl: 'ws://127.0.0.1:1', // unreachable; spawns will go offline immediately
        authToken: null,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected address info');
    const base = `http://127.0.0.1:${addr.port}`;
    return { app, store, manager, base };
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('deleted-devices admin endpoints', () => {
    let cleanup: (() => Promise<void>) | null = null;
    afterEach(async () => {
        if (cleanup) await cleanup();
        cleanup = null;
    });

    it('GET /api/devices/deleted lists soft-deleted rows; live ones excluded', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        // Create two; soft-delete one.
        const a = await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json() as Promise<{ id: string }>);
        await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'DC' }),
        });
        await fetch(`${base}/api/devices/${a.id}`, { method: 'DELETE' });

        const listed = (await fetch(`${base}/api/devices/deleted`).then((r) => r.json())) as Array<{
            id: string;
            deletedAt: string;
        }>;
        expect(listed).toHaveLength(1);
        expect(listed[0]?.id).toBe(a.id);
        expect(typeof listed[0]?.deletedAt).toBe('string');

        // Live list still shows the second (DC) one.
        const live = (await fetch(`${base}/api/devices`).then((r) => r.json())) as Array<{ id: string }>;
        expect(live.find((d) => d.id === a.id)).toBeUndefined();
    });

    it('POST /api/devices/:id/restore brings the device back to the live list', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json() as Promise<{ id: string }>);
        await fetch(`${base}/api/devices/${created.id}`, { method: 'DELETE' });

        const restored = await fetch(`${base}/api/devices/${created.id}/restore`, {
            method: 'POST',
        });
        expect(restored.status).toBe(200);

        const live = (await fetch(`${base}/api/devices`).then((r) => r.json())) as Array<{ id: string }>;
        expect(live.find((d) => d.id === created.id)).toBeDefined();
        const deleted = (await fetch(`${base}/api/devices/deleted`).then((r) => r.json())) as Array<{
            id: string;
        }>;
        expect(deleted).toHaveLength(0);
    });

    it('POST .../restore on an unknown id returns 404', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const r = await fetch(`${base}/api/devices/nope/restore`, { method: 'POST' });
        expect(r.status).toBe(404);
    });

    it('DELETE .../purge requires ?confirm=PURGE and cascades sessions', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json() as Promise<{ id: string }>);
        // Add a session row directly so we can verify the cascade.
        store.insertSession({
            deviceId: created.id,
            connectorId: 1,
            transactionId: 1,
            idTag: 'TAG',
            status: 'completed',
            startedAt: '2026-05-09T12:00:00.000Z',
            endedAt: '2026-05-09T12:30:00.000Z',
            endReason: 'Local',
            energyWh: 100,
            peakPowerKw: 5,
        });
        await fetch(`${base}/api/devices/${created.id}`, { method: 'DELETE' });

        // Missing / wrong query → 400, no purge.
        const noConfirm = await fetch(`${base}/api/devices/${created.id}/purge`, { method: 'DELETE' });
        expect(noConfirm.status).toBe(400);
        const wrongConfirm = await fetch(`${base}/api/devices/${created.id}/purge?confirm=YES`, {
            method: 'DELETE',
        });
        expect(wrongConfirm.status).toBe(400);

        const purge = await fetch(`${base}/api/devices/${created.id}/purge?confirm=PURGE`, {
            method: 'DELETE',
        });
        expect(purge.status).toBe(204);

        // Audit trail wiped: that's the contract of purge.
        expect(store.listSessions({ deviceId: created.id })).toEqual([]);
        const deleted = (await fetch(`${base}/api/devices/deleted`).then((r) => r.json())) as unknown[];
        expect(deleted).toEqual([]);
    });

    it('DELETE .../purge refuses to drop a live device', async () => {
        const { app, base, manager, store } = await setup();
        cleanup = async () => {
            await manager.stopAll();
            await sleep(20);
            await app.close();
            store.close();
        };
        const created = await fetch(`${base}/api/devices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'AC' }),
        }).then((r) => r.json() as Promise<{ id: string }>);
        // Skip the soft-delete step on purpose.
        const r = await fetch(`${base}/api/devices/${created.id}/purge?confirm=PURGE`, {
            method: 'DELETE',
        });
        expect(r.status).toBe(404);
        // Device still alive.
        const live = (await fetch(`${base}/api/devices`).then((r) => r.json())) as Array<{ id: string }>;
        expect(live.find((d) => d.id === created.id)).toBeDefined();
    });
});
