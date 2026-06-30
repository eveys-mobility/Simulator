import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildServer } from './api.js';
import { DeviceManager } from './device-manager.js';
import { Store } from './store.js';

/**
 * Live-WS coalescing tests. The hub must:
 *  - pass through state/session frames without batching (UI relies
 *    on connector-status flips landing immediately)
 *  - keep only the latest tick per (deviceId, connectorId) inside
 *    each 100ms flush window
 *  - keep only the latest MeterValues / Heartbeat frame per
 *    (deviceId, action) inside the window, and report how many were
 *    dropped via a frames-coalesced summary message
 *
 * If these go red, a 200-device fleet doing 1Hz MeterValues will push
 * thousands of WS messages per second to every browser tab.
 */

interface AnyMessage {
    type: string;
    payload?: unknown;
    dropped?: number;
    byDevice?: Record<string, number>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const setup = async () => {
    const store = new Store(':memory:');
    const manager = new DeviceManager(store);
    const app = await buildServer({
        store,
        manager,
        defaultOcppUrl: 'ws://localhost:1',
        authToken: null,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected address info');
    const url = `ws://127.0.0.1:${addr.port}/api/ws`;
    return { app, manager, store, url };
};

const collect = async (url: string, ms: number, drive: () => void) => {
    const ws = new WebSocket(url);
    const messages: AnyMessage[] = [];
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.on('message', (raw) => {
        try {
            messages.push(JSON.parse(String(raw)) as AnyMessage);
        } catch {}
    });
    // Drop the initial 'hello' so test assertions don't fight it.
    drive();
    await sleep(ms);
    ws.close();
    await new Promise<void>((resolve) => ws.once('close', () => resolve()));
    return messages.filter((m) => m.type !== 'hello');
};

describe('WS broadcast coalescing', () => {
    let cleanup: (() => Promise<void>) | null = null;
    afterEach(async () => {
        if (cleanup) await cleanup();
        cleanup = null;
    });

    it('coalesces a burst of MeterValues frames into one per (device, action)', async () => {
        const { app, manager, store, url } = await setup();
        cleanup = async () => {
            await app.close();
            store.close();
        };
        const messages = await collect(url, 250, () => {
            // Fire 50 MeterValues for the same device — only the
            // latest should survive within the 100ms window.
            for (let i = 0; i < 50; i++) {
                manager.emit('frame', {
                    deviceId: 'cp_x',
                    direction: 'in',
                    action: 'MeterValues',
                    id: `id-${i}`,
                    payload: { i },
                });
            }
        });
        const meterFrames = messages.filter(
            (m) =>
                m.type === 'frame' && (m.payload as { action?: string }).action === 'MeterValues',
        );
        expect(meterFrames.length).toBeLessThanOrEqual(2);
        const summary = messages.find((m) => m.type === 'frames-coalesced');
        expect(summary?.dropped ?? 0).toBeGreaterThanOrEqual(48);
        // Per-device telemetry must include the device that fired the
        // burst — otherwise the SPA can't scope the indicator to the
        // tab the operator is on.
        expect(summary?.byDevice?.cp_x ?? 0).toBeGreaterThanOrEqual(48);
    });

    it('attributes drops to the right device when two are burst-firing', async () => {
        const { app, manager, store, url } = await setup();
        cleanup = async () => {
            await app.close();
            store.close();
        };
        const messages = await collect(url, 250, () => {
            for (let i = 0; i < 30; i++) {
                manager.emit('frame', {
                    deviceId: 'cp_a',
                    direction: 'in',
                    action: 'MeterValues',
                    id: `a-${i}`,
                    payload: {},
                });
                manager.emit('frame', {
                    deviceId: 'cp_b',
                    direction: 'in',
                    action: 'MeterValues',
                    id: `b-${i}`,
                    payload: {},
                });
            }
        });
        const summary = messages.find((m) => m.type === 'frames-coalesced');
        expect(summary?.byDevice?.cp_a ?? 0).toBeGreaterThanOrEqual(28);
        expect(summary?.byDevice?.cp_b ?? 0).toBeGreaterThanOrEqual(28);
    });

    it('coalesces ticks per (device, connector)', async () => {
        const { app, manager, store, url } = await setup();
        cleanup = async () => {
            await app.close();
            store.close();
        };
        const messages = await collect(url, 250, () => {
            for (let i = 0; i < 100; i++) {
                manager.emit('tick', {
                    deviceId: 'cp_a',
                    connectorId: 1,
                    powerKw: i,
                    energyKwh: i / 10,
                });
            }
        });
        const ticks = messages.filter((m) => m.type === 'tick');
        // 100 raw → at most 2 (one per 100ms window over the 250ms run).
        expect(ticks.length).toBeLessThanOrEqual(2);
        // The latest payload wins.
        const last = ticks[ticks.length - 1]?.payload as { powerKw: number };
        expect(last.powerKw).toBe(99);
    });

    it('does NOT coalesce StartTransaction / StopTransaction / StatusNotification', async () => {
        const { app, manager, store, url } = await setup();
        cleanup = async () => {
            await app.close();
            store.close();
        };
        const messages = await collect(url, 200, () => {
            manager.emit('frame', {
                deviceId: 'cp_a',
                action: 'StartTransaction',
                id: '1',
                direction: 'out',
            });
            manager.emit('frame', {
                deviceId: 'cp_a',
                action: 'StatusNotification',
                id: '2',
                direction: 'out',
            });
            manager.emit('frame', {
                deviceId: 'cp_a',
                action: 'StopTransaction',
                id: '3',
                direction: 'out',
            });
        });
        const actions = messages
            .filter((m) => m.type === 'frame')
            .map((m) => (m.payload as { action?: string }).action);
        expect(actions).toContain('StartTransaction');
        expect(actions).toContain('StatusNotification');
        expect(actions).toContain('StopTransaction');
    });

    it('passes state and session events through immediately without batching', async () => {
        const { app, manager, store, url } = await setup();
        cleanup = async () => {
            await app.close();
            store.close();
        };
        const messages = await collect(url, 200, () => {
            manager.emit('state', { deviceId: 'cp_x', online: true });
            manager.emit('session', { deviceId: 'cp_x', type: 'started' });
        });
        expect(messages.find((m) => m.type === 'state')).toBeTruthy();
        expect(messages.find((m) => m.type === 'session')).toBeTruthy();
    });
});
