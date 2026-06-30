import { EventEmitter } from 'node:events';
import { v4 as uuid } from 'uuid';
import { WebSocket } from 'ws';
import {
    BootNotificationResSchema,
    type Device,
    MessageType,
    ProtocolError,
    type StartTransactionRes,
    StartTransactionResSchema,
    decodeFrame,
    encodeCall,
    encodeError,
    encodeResult,
} from '@ocpp-sim/core';
import {
    ocppBootLatencySeconds,
    ocppCallErrorsTotal,
    ocppCallLatencySeconds,
    ocppCallTotal,
    ocppFramesTotal,
    ocppWsReconnectsTotal,
} from './metrics.js';

interface PendingCall {
    resolve: (payload: unknown) => void;
    reject: (err: Error) => void;
    action: string;
    timeout: NodeJS.Timeout;
    /** Wall-clock start of the CALL, in seconds (process.hrtime-based). */
    startedAtSec: number;
}

const CALL_TIMEOUT_MS = 30_000;
/** OCPP allows any positive integer. Floor at 1s so local-testing
 *  values aren't silently bumped up; cap at 24h so a misconfigured
 *  CSMS sending 0 or absurd values can't disable heartbeats entirely. */
const HEARTBEAT_MIN_SEC = 1;
const HEARTBEAT_MAX_SEC = 86_400; // 24h — anything beyond is effectively never
const HEARTBEAT_DEFAULT_SEC = 60;

function clampHeartbeat(raw: number, label: string): number {
    if (!Number.isFinite(raw) || raw <= 0) return HEARTBEAT_DEFAULT_SEC;
    if (raw < HEARTBEAT_MIN_SEC) {
        console.warn(
            `[ocpp] ${label} heartbeat ${raw}s below ${HEARTBEAT_MIN_SEC}s floor; clamping`,
        );
        return HEARTBEAT_MIN_SEC;
    }
    if (raw > HEARTBEAT_MAX_SEC) return HEARTBEAT_MAX_SEC;
    return raw;
}

export interface OcppClientOptions {
    /**
     * Disable TLS certificate verification on `wss://` connections.
     * Maps to `rejectUnauthorized: false` in the ws library.
     * Use only for self-signed dev/staging CSMSes — never in production.
     */
    tlsInsecure?: boolean;
}

/**
 * Result of handling a CSMS-initiated CALL. The Simulator owns
 * the actual semantics; OcppClient just turns this into a frame.
 */
export type IncomingCallResult =
    | { ok: true; result: unknown }
    | { ok: false; code: string; description: string };

export type IncomingCallHandler = (action: string, payload: unknown) => Promise<IncomingCallResult>;

/**
 * One OCPP 1.6J client per device. Owns the WebSocket to the gateway,
 * tracks in-flight CALLs by id, surfaces high-level events. Reconnects
 * with exponential backoff on close.
 */
export class OcppClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private pending = new Map<string, PendingCall>();
    private connected = false;
    private heartbeat: NodeJS.Timeout | null = null;
    private reconnect: NodeJS.Timeout | null = null;
    private bootRetry: NodeJS.Timeout | null = null;
    private bootDeferred = false;
    private heartbeatIntervalSec = HEARTBEAT_DEFAULT_SEC;
    private reconnectAttempt = 0;
    private stopped = false;
    private forcedOffline = false;
    private incomingHandler: IncomingCallHandler | null = null;

    constructor(
        private readonly device: Device,
        private readonly options: OcppClientOptions = {},
    ) {
        super();
    }

    /** Register the function that decides how to respond to CSMS CALLs.
     *  Must be set before the WebSocket opens; without it, every incoming
     *  CALL gets a NotImplemented CALLERROR. */
    setIncomingHandler(h: IncomingCallHandler): void {
        this.incomingHandler = h;
    }

    /** Close the socket without stopping. The `close` handler schedules
     *  a reconnect, so this models a Reset-style soft restart of the
     *  WebSocket without tearing down the device. */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
        }
    }

    /** Force the device offline and keep it that way until goOnline().
     *  Used to exercise the offline queue: the CP keeps charging locally,
     *  StopTransaction / MeterValues are buffered to SQLite, and the
     *  drain fires when the operator flips it back online. Unlike
     *  disconnect(), this suppresses the automatic reconnect. */
    forceOffline(): void {
        this.forcedOffline = true;
        if (this.reconnect) {
            clearTimeout(this.reconnect);
            this.reconnect = null;
        }
        if (this.ws) this.ws.close();
    }

    goOnline(): void {
        if (!this.forcedOffline) return;
        this.forcedOffline = false;
        if (!this.connected && !this.reconnect) void this.openSocket();
    }

    isForcedOffline(): boolean {
        return this.forcedOffline;
    }

    /** Update the heartbeat cadence. Used when the CSMS issues a
     *  ChangeConfiguration for HeartbeatInterval. Idempotent — restarts
     *  the interval timer at the new cadence. Values are clamped to a
     *  safe window (see HEARTBEAT_MIN/MAX_SEC). */
    setHeartbeatIntervalSec(seconds: number): void {
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        this.heartbeatIntervalSec = clampHeartbeat(seconds, this.device.id);
        // startHeartbeat clears the prior interval before arming the new
        // one, so we don't have to do it here. Only re-arm if we're
        // actually online and past Boot — otherwise let the on-open /
        // boot-retry path arm at the right moment.
        if (this.connected && !this.bootDeferred) this.startHeartbeat();
    }

    isOnline(): boolean {
        return this.connected;
    }

    async start(): Promise<void> {
        await this.openSocket();
    }

    stop(): void {
        this.stopped = true;
        if (this.reconnect) clearTimeout(this.reconnect);
        if (this.bootRetry) clearTimeout(this.bootRetry);
        if (this.heartbeat) clearInterval(this.heartbeat);
        for (const p of this.pending.values()) {
            clearTimeout(p.timeout);
            p.reject(new Error('client stopped'));
        }
        this.pending.clear();
        if (this.ws) {
            // Drop our listeners, but install a no-op `error` handler so
            // the async close-during-connect rejection (common when stop
            // races a still-connecting socket) doesn't bubble up as an
            // unhandled error event.
            this.ws.removeAllListeners();
            this.ws.on('error', () => undefined);
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }

    /** Send a CALL and resolve when the matching CALLRESULT arrives. */
    async call<T>(
        action: string,
        payload: unknown,
        validate?: { parse: (raw: unknown) => T },
    ): Promise<T> {
        if (!this.connected || !this.ws) throw new Error(`device ${this.device.id} not connected`);
        const id = uuid();
        const wire = encodeCall(id, action, payload);
        const startedAtSec = Date.now() / 1000;
        const deviceType = this.device.type;
        ocppCallTotal.inc({ action, direction: 'out', device_type: deviceType });
        ocppFramesTotal.inc({ direction: 'out', frame_type: 'CALL' });
        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                ocppCallErrorsTotal.inc({ action, error_code: 'Timeout' });
                reject(new Error(`CALL ${action} (${id}) timed out`));
            }, CALL_TIMEOUT_MS);
            this.pending.set(id, {
                action,
                timeout,
                startedAtSec,
                resolve: (raw) => resolve(validate ? validate.parse(raw) : (raw as T)),
                reject,
            });
            this.ws?.send(wire);
            this.emit('frame', { direction: 'out', id, action, payload });
        });
    }

    private async openSocket(): Promise<void> {
        if (this.stopped || this.forcedOffline) return;
        const url = `${this.device.ocppUrl}/${this.device.id}`;
        const headers: Record<string, string> = {};
        if (this.device.authPassword) {
            // OCPP 1.6 §17.4: charge-point identifier is the username,
            // pre-shared password is the password. URL path already
            // carries the identifier, but the server still validates
            // it against the Authorization header.
            const creds = Buffer.from(`${this.device.id}:${this.device.authPassword}`).toString(
                'base64',
            );
            headers.Authorization = `Basic ${creds}`;
        }
        const isWss = url.startsWith('wss://');
        const ws = new WebSocket(url, ['ocpp1.6'], {
            headers,
            // Only meaningful for wss:// — `ws` ignores TLS opts on plain ws.
            rejectUnauthorized: isWss ? !this.options.tlsInsecure : undefined,
            handshakeTimeout: 15_000,
        });
        this.ws = ws;

        ws.on('open', async () => {
            this.connected = true;
            this.reconnectAttempt = 0;
            this.emit('online');
            try {
                await this.sendBoot();
                // §4.2: only start the heartbeat loop once the CSMS has
                // accepted us. While bootDeferred is true, sendBoot has
                // already scheduled a retry on its own timer.
                if (!this.bootDeferred) this.startHeartbeat();
            } catch (err) {
                this.emit('error', err);
            }
        });

        ws.on('message', (data) => this.handleFrame(data.toString()));

        ws.on('close', (code, reason) => {
            this.connected = false;
            if (this.heartbeat) clearInterval(this.heartbeat);
            this.heartbeat = null;
            this.emit('offline', { code, reason: reason.toString() });
            this.scheduleReconnect();
        });

        ws.on('error', (err) => {
            this.emit('error', err);
        });
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.reconnect || this.forcedOffline) return;
        this.reconnectAttempt++;
        ocppWsReconnectsTotal.inc();
        // Exponential backoff with full jitter (AWS architecture blog
        // "Exponential Backoff And Jitter"). Without jitter, every device
        // that lost the gateway in the same tick reconnects in lockstep
        // and produces a thundering herd; the CSMS sees N simultaneous
        // BootNotifications. Random spread inside the window smooths it
        // out without changing the worst-case delay.
        const ceiling = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
        const backoff = Math.floor(Math.random() * ceiling);
        this.reconnect = setTimeout(() => {
            this.reconnect = null;
            void this.openSocket();
        }, backoff);
    }

    private handleFrame(raw: string): void {
        let frame;
        try {
            frame = decodeFrame(raw);
        } catch (err) {
            this.emit(
                'error',
                err instanceof ProtocolError ? err : new ProtocolError('decode failed', raw),
            );
            return;
        }

        const deviceType = this.device.type;
        if (frame[0] === MessageType.CALL) {
            const [, id, action, payload] = frame;
            ocppCallTotal.inc({ action, direction: 'in', device_type: deviceType });
            ocppFramesTotal.inc({ direction: 'in', frame_type: 'CALL' });
            this.emit('frame', { direction: 'in', id, action, payload });
            void this.handleIncomingCall(id, action, payload);
            return;
        }
        if (frame[0] === MessageType.CALLRESULT) {
            const [, id, payload] = frame;
            ocppFramesTotal.inc({ direction: 'in', frame_type: 'CALLRESULT' });
            const p = this.pending.get(id);
            if (!p) return;
            this.pending.delete(id);
            clearTimeout(p.timeout);
            const latency = Date.now() / 1000 - p.startedAtSec;
            ocppCallLatencySeconds.observe({ action: p.action, device_type: deviceType }, latency);
            if (p.action === 'BootNotification') {
                ocppBootLatencySeconds.observe({ device_type: deviceType }, latency);
            }
            this.emit('frame', { direction: 'in', id, action: p.action, payload });
            try {
                p.resolve(payload);
            } catch (err) {
                p.reject(err as Error);
            }
            return;
        }
        if (frame[0] === MessageType.CALLERROR) {
            const [, id, code, description] = frame;
            ocppFramesTotal.inc({ direction: 'in', frame_type: 'CALLERROR' });
            const p = this.pending.get(id);
            if (!p) return;
            this.pending.delete(id);
            clearTimeout(p.timeout);
            ocppCallErrorsTotal.inc({ action: p.action, error_code: String(code) });
            p.reject(new Error(`${code}: ${description}`));
        }
    }

    private async handleIncomingCall(id: string, action: string, payload: unknown): Promise<void> {
        if (!this.incomingHandler) {
            this.ws?.send(encodeError(id, 'NotImplemented', `no handler registered for ${action}`));
            return;
        }
        let outcome: IncomingCallResult;
        try {
            outcome = await this.incomingHandler(action, payload);
        } catch (err) {
            outcome = { ok: false, code: 'InternalError', description: (err as Error).message };
        }
        if (!this.ws) return;
        if (outcome.ok) {
            this.ws.send(encodeResult(id, outcome.result));
        } else {
            this.ws.send(encodeError(id, outcome.code, outcome.description));
        }
    }

    private async sendBoot(): Promise<void> {
        const res = await this.call(
            'BootNotification',
            {
                chargePointVendor: this.device.vendor,
                chargePointModel: this.device.model,
                chargePointSerialNumber: this.device.id,
                firmwareVersion: this.device.firmwareVersion,
                meterType: 'Virtual',
                meterSerialNumber: `METER-${this.device.id}`,
            },
            BootNotificationResSchema,
        );
        if (res.status !== 'Accepted') {
            // OCPP 1.6 §4.2: on Rejected/Pending, the charge point must
            // not send any other messages and must retry BootNotification
            // after `interval` seconds. We honor that by *not* starting
            // heartbeats or letting the Simulator emit anything until the
            // next boot succeeds. The retry runs on a one-shot timer so
            // it doesn't need to share the heartbeat interval timer.
            this.bootDeferred = true;
            const retrySec = res.interval > 0 ? res.interval : 60;
            this.emit('boot-deferred', { status: res.status, retrySec });
            this.scheduleBootRetry(retrySec);
            return;
        }
        this.bootDeferred = false;
        this.heartbeatIntervalSec = clampHeartbeat(res.interval, this.device.id);
        this.emit('booted', res);
    }

    private scheduleBootRetry(seconds: number): void {
        if (this.bootRetry) clearTimeout(this.bootRetry);
        this.bootRetry = setTimeout(() => {
            this.bootRetry = null;
            if (this.stopped || !this.connected) return;
            this.sendBoot()
                .then(() => {
                    if (!this.bootDeferred) this.startHeartbeat();
                })
                .catch((err) => this.emit('error', err));
        }, seconds * 1000);
    }

    /** True until the CSMS Accepts a BootNotification. While deferred,
     *  the Simulator must not issue StatusNotification, MeterValues,
     *  StartTransaction, etc. — only Heartbeat is allowed by §4.2. */
    isBootDeferred(): boolean {
        return this.bootDeferred;
    }

    private startHeartbeat(): void {
        // Always clear the previous timer before arming. Node's setInterval
        // returns a fresh handle; without clearInterval the old one keeps
        // firing forever — so every reconnect / boot-retry / config change
        // that lands here would add another parallel Heartbeat loop, and
        // the rate would compound. Single-fix for "lots of heartbeats at
        // the same time" reports.
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
            this.call('Heartbeat', {}).catch((err) => this.emit('error', err));
        }, this.heartbeatIntervalSec * 1000);
    }

    // ---- helpers used by Simulator ----

    sendStatusNotification(
        connectorId: number,
        status: string,
        errorCode = 'NoError',
    ): Promise<unknown> {
        return this.call('StatusNotification', {
            connectorId,
            errorCode,
            status,
            timestamp: new Date().toISOString(),
        });
    }

    startTransaction(args: {
        connectorId: number;
        idTag: string;
        meterStart: number;
    }): Promise<StartTransactionRes> {
        return this.call(
            'StartTransaction',
            {
                connectorId: args.connectorId,
                idTag: args.idTag,
                meterStart: args.meterStart,
                timestamp: new Date().toISOString(),
            },
            StartTransactionResSchema,
        );
    }

    stopTransaction(args: {
        // Spec: integer. Toger / OCPI bridge: UUID string — accepted
        // here for symmetry with StartTransactionResSchema's union.
        transactionId: number | string;
        meterStop: number;
        reason: string;
        idTag?: string;
        timestamp?: string;
    }): Promise<unknown> {
        return this.call('StopTransaction', {
            transactionId: args.transactionId,
            idTag: args.idTag,
            meterStop: args.meterStop,
            timestamp: args.timestamp ?? new Date().toISOString(),
            reason: args.reason,
        });
    }

    /**
     * Send a MeterValues frame whose `sampledValue[]` is computed by
     * the caller. The Simulator builds the array from the AC/DC
     * measurand emitters in @ocpp-sim/core/sim, filtered against the
     * device's `MeterValuesSampledData` config key. `timestamp` should
     * be the *sample* time — for offline-queued replays this preserves
     * when the energy was actually measured, not when it was delivered.
     */
    sendMeterValueRich(
        connectorId: number,
        // Spec: integer. Toger / OCPI bridge: string.
        transactionId: number | string,
        sampledValue: unknown[],
        timestamp?: string,
    ): Promise<unknown> {
        return this.call('MeterValues', {
            connectorId,
            transactionId,
            meterValue: [{ timestamp: timestamp ?? new Date().toISOString(), sampledValue }],
        });
    }

    /**
     * Replay-path send. The offline queue stores a fully-formed OCPP
     * payload and replays it verbatim on reconnect; the action string
     * decides only the routing on the CSMS side. Bypasses the helper
     * methods so the *original* timestamp inside the payload is
     * preserved untouched.
     */
    callRaw(action: string, payload: unknown): Promise<unknown> {
        return this.call(action, payload);
    }

    /**
     * Convenience for trigger-message paths and tests. Emits the same
     * minimal pair the v1 simulator did.
     */
    sendMeterValue(
        connectorId: number,
        transactionId: number,
        energyWh: number,
        powerW: number,
    ): Promise<unknown> {
        return this.sendMeterValueRich(connectorId, transactionId, [
            {
                value: String(Math.round(energyWh)),
                measurand: 'Energy.Active.Import.Register',
                unit: 'Wh',
            },
            { value: String(Math.round(powerW)), measurand: 'Power.Active.Import', unit: 'W' },
        ]);
    }
}
