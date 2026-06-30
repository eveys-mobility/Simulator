import type { AddressInfo } from 'node:net';
import { MessageType, decodeFrame, encodeError, encodeResult } from '@ocpp-sim/core';
import { v4 as uuid } from 'uuid';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { defaultHandlers } from './default-handlers.js';
import { DeviceHandle } from './device-handle.js';
import type { DeviceCallHandler, MockCsmsOptions, RecordedFrame } from './types.js';

interface PendingCsmsCall {
    resolve: (payload: unknown) => void;
    reject: (err: Error) => void;
    action: string;
    timer: NodeJS.Timeout;
}

interface DeviceState {
    deviceId: string;
    ws: WebSocket;
    frames: RecordedFrame[];
    pending: Map<string, PendingCsmsCall>;
    /** Listeners awaiting an inbound action. */
    waiters: { action: string; resolve: (frame: RecordedFrame) => void }[];
    /** Listeners awaiting any frame (used by waitForBoot etc.). */
    anyFrameWaiters: ((frame: RecordedFrame) => void)[];
    /** HTTP upgrade headers sent by the device. Lets tests assert on
     *  Authorization etc. */
    upgradeHeaders: Record<string, string | string[] | undefined>;
}

/**
 * In-memory CSMS for tests. Listens on a WebSocket port, accepts
 * any path-as-deviceId URL the simulator dials, records every frame,
 * auto-responds to device-initiated CALLs, and exposes a typed API
 * for sending CSMS-initiated CALLs.
 *
 * Lifecycle:
 *
 *   const csms = new MockCsms();
 *   await csms.start();
 *   // … point the simulator at csms.url, drive the test, then:
 *   await csms.stop();
 *
 * `csms.url` is the ws:// URL the simulator should connect to;
 * the device id becomes the URL path.
 */
export class MockCsms {
    private wss: WebSocketServer | null = null;
    private devices = new Map<string, DeviceState>();
    private handlers: Record<string, DeviceCallHandler>;
    private port: number;
    private actualPort = 0;

    constructor(opts: MockCsmsOptions = {}) {
        this.port = opts.port ?? 0;
        const merged: Record<string, DeviceCallHandler> = defaultHandlers();
        for (const [k, v] of Object.entries(opts.handlers ?? {})) {
            if (v) merged[k] = v;
        }
        this.handlers = merged;
    }

    async start(): Promise<void> {
        if (this.wss) return;
        this.wss = new WebSocketServer({ port: this.port });
        await new Promise<void>((resolve, reject) => {
            this.wss?.on('listening', () => {
                const addr = this.wss?.address() as AddressInfo;
                this.actualPort = addr.port;
                resolve();
            });
            this.wss?.on('error', reject);
        });
        this.wss.on('connection', (ws, req) => this.onConnection(ws, req.url ?? '/', req.headers));
    }

    async stop(): Promise<void> {
        if (!this.wss) return;
        // Reject any in-flight CSMS calls so awaiting tests don't hang.
        for (const dev of this.devices.values()) {
            for (const p of dev.pending.values()) {
                clearTimeout(p.timer);
                p.reject(new Error('csms stopping'));
            }
            dev.pending.clear();
            dev.ws.removeAllListeners();
            dev.ws.on('error', () => undefined);
            dev.ws.close();
        }
        this.devices.clear();
        await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
        this.wss = null;
    }

    /** ws:// URL the simulator should target. Trailing path = device id. */
    get url(): string {
        return `ws://127.0.0.1:${this.actualPort}`;
    }

    /** Replace the responder for a specific device-initiated action. */
    setHandler(action: string, handler: DeviceCallHandler): void {
        this.handlers[action] = handler;
    }

    /** Restore the default responder for an action. */
    clearHandler(action: string): void {
        this.handlers[action] = defaultHandlers()[action] ?? (() => ({}));
    }

    /**
     * Get a typed handle for one connected device. Throws if the
     * device hasn't connected yet — call `csms.waitForDevice(id)` first
     * if the test races with the simulator's WS open.
     */
    device(deviceId: string): DeviceHandle {
        const state = this.devices.get(deviceId);
        if (!state) throw new Error(`device ${deviceId} not connected`);
        return new DeviceHandle(state, (action, payload) =>
            this.callDevice(state, action, payload),
        );
    }

    /** Wait for a device to connect. Resolves immediately if already in. */
    async waitForDevice(deviceId: string, timeoutMs = 5000): Promise<DeviceHandle> {
        if (this.devices.has(deviceId)) return this.device(deviceId);
        return new Promise<DeviceHandle>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.wss?.off('connection', listener);
                reject(new Error(`device ${deviceId} did not connect within ${timeoutMs}ms`));
            }, timeoutMs);
            const listener = () => {
                if (this.devices.has(deviceId)) {
                    clearTimeout(timer);
                    this.wss?.off('connection', listener);
                    resolve(this.device(deviceId));
                }
            };
            this.wss?.on('connection', listener);
        });
    }

    /** All currently connected devices. */
    devicesList(): string[] {
        return [...this.devices.keys()];
    }

    // ---- Internals ----

    private onConnection(
        ws: WebSocket,
        urlPath: string,
        headers: Record<string, string | string[] | undefined>,
    ): void {
        // url is `/<deviceId>` (no query string handling; OCPP URLs are bare).
        const deviceId = decodeURIComponent(urlPath.replace(/^\//, '').split('?')[0] ?? '');
        if (!deviceId) {
            ws.close(1008, 'missing device id');
            return;
        }
        const state: DeviceState = {
            deviceId,
            ws,
            frames: [],
            pending: new Map(),
            waiters: [],
            anyFrameWaiters: [],
            upgradeHeaders: headers,
        };
        this.devices.set(deviceId, state);
        ws.on('message', (data) => this.onMessage(state, data.toString()));
        ws.on('close', () => {
            this.devices.delete(deviceId);
        });
        ws.on('error', () => undefined);
    }

    private onMessage(dev: DeviceState, raw: string): void {
        let frame: ReturnType<typeof decodeFrame>;
        try {
            frame = decodeFrame(raw);
        } catch (err) {
            // Drop garbage; OCPP says ignore unparseable.
            void err;
            return;
        }
        if (frame[0] === MessageType.CALL) {
            const [, id, action, payload] = frame;
            const recorded: RecordedFrame = {
                direction: 'in',
                type: 'CALL',
                id,
                action,
                payload,
                at: Date.now(),
            };
            this.recordFrame(dev, recorded);
            void this.respondToDeviceCall(dev, id, action, payload);
            return;
        }
        if (frame[0] === MessageType.CALLRESULT) {
            const [, id, payload] = frame;
            const p = dev.pending.get(id);
            const action = p?.action;
            const recorded: RecordedFrame = {
                direction: 'in',
                type: 'CALLRESULT',
                id,
                action,
                payload,
                at: Date.now(),
            };
            this.recordFrame(dev, recorded);
            if (p) {
                clearTimeout(p.timer);
                dev.pending.delete(id);
                p.resolve(payload);
            }
            return;
        }
        if (frame[0] === MessageType.CALLERROR) {
            const [, id, code, description] = frame;
            const p = dev.pending.get(id);
            const action = p?.action;
            const recorded: RecordedFrame = {
                direction: 'in',
                type: 'CALLERROR',
                id,
                action,
                payload: { code, description },
                at: Date.now(),
            };
            this.recordFrame(dev, recorded);
            if (p) {
                clearTimeout(p.timer);
                dev.pending.delete(id);
                p.reject(new Error(`${String(code)}: ${String(description)}`));
            }
        }
    }

    private async respondToDeviceCall(
        dev: DeviceState,
        id: string,
        action: string,
        payload: unknown,
    ): Promise<void> {
        const handler = this.handlers[action];
        try {
            const result = handler
                ? await handler(payload, { deviceId: dev.deviceId, action })
                : {};
            if (dev.ws.readyState !== dev.ws.OPEN) return;
            const wire = encodeResult(id, result);
            dev.ws.send(wire);
            this.recordFrame(dev, {
                direction: 'out',
                type: 'CALLRESULT',
                id,
                action,
                payload: result,
                at: Date.now(),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const wire = encodeError(id, 'InternalError', message);
            if (dev.ws.readyState === dev.ws.OPEN) dev.ws.send(wire);
            this.recordFrame(dev, {
                direction: 'out',
                type: 'CALLERROR',
                id,
                action,
                payload: { code: 'InternalError', description: message },
                at: Date.now(),
            });
        }
    }

    private callDevice(dev: DeviceState, action: string, payload: unknown): Promise<unknown> {
        if (dev.ws.readyState !== dev.ws.OPEN) {
            return Promise.reject(new Error(`device ${dev.deviceId} not connected`));
        }
        const id = uuid();
        const wire = JSON.stringify([MessageType.CALL, id, action, payload]);
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (dev.pending.delete(id)) {
                    reject(new Error(`CSMS CALL ${action} (${id}) timed out`));
                }
            }, 5000);
            dev.pending.set(id, { action, resolve, reject, timer });
            dev.ws.send(wire);
            this.recordFrame(dev, {
                direction: 'out',
                type: 'CALL',
                id,
                action,
                payload,
                at: Date.now(),
            });
        });
    }

    private recordFrame(dev: DeviceState, f: RecordedFrame): void {
        dev.frames.push(f);
        // Fan out to anyone awaiting a specific action.
        const remaining: typeof dev.waiters = [];
        for (const w of dev.waiters) {
            if (f.direction === 'in' && f.type === 'CALL' && f.action === w.action) {
                w.resolve(f);
            } else {
                remaining.push(w);
            }
        }
        dev.waiters = remaining;
        // Snapshot the watcher list before invoking — a watcher may
        // mutate `dev.anyFrameWaiters` (typically to remove itself once
        // it finds its match). Don't clear unconditionally; that broke
        // any-multi-frame waiters whose match wasn't the first frame.
        const watchers = [...dev.anyFrameWaiters];
        for (const w of watchers) w(f);
    }
}
