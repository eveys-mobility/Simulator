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

interface PendingCall {
    resolve: (payload: unknown) => void;
    reject: (err: Error) => void;
    action: string;
    timeout: NodeJS.Timeout;
}

const CALL_TIMEOUT_MS = 30_000;

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
    private heartbeatIntervalSec = 300;
    private reconnectAttempt = 0;
    private stopped = false;
    private incomingHandler: IncomingCallHandler | null = null;

    constructor(private readonly device: Device) {
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

    /** Update the heartbeat cadence. Used when the CSMS issues a
     *  ChangeConfiguration for HeartbeatInterval. Idempotent — restarts
     *  the interval timer at the new cadence. */
    setHeartbeatIntervalSec(seconds: number): void {
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        this.heartbeatIntervalSec = seconds;
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.startHeartbeat();
        }
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
    async call<T>(action: string, payload: unknown, validate?: { parse: (raw: unknown) => T }): Promise<T> {
        if (!this.connected || !this.ws) throw new Error(`device ${this.device.id} not connected`);
        const id = uuid();
        const wire = encodeCall(id, action, payload);
        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CALL ${action} (${id}) timed out`));
            }, CALL_TIMEOUT_MS);
            this.pending.set(id, {
                action,
                timeout,
                resolve: (raw) => resolve(validate ? validate.parse(raw) : (raw as T)),
                reject,
            });
            this.ws?.send(wire);
            this.emit('frame', { direction: 'out', id, action, payload });
        });
    }

    private async openSocket(): Promise<void> {
        if (this.stopped) return;
        const url = `${this.device.ocppUrl}/${this.device.id}`;
        const ws = new WebSocket(url, ['ocpp1.6']);
        this.ws = ws;

        ws.on('open', async () => {
            this.connected = true;
            this.reconnectAttempt = 0;
            this.emit('online');
            try {
                await this.sendBoot();
                this.startHeartbeat();
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
        if (this.stopped || this.reconnect) return;
        this.reconnectAttempt++;
        const backoff = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
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
            this.emit('error', err instanceof ProtocolError ? err : new ProtocolError('decode failed', raw));
            return;
        }

        if (frame[0] === MessageType.CALL) {
            const [, id, action, payload] = frame;
            this.emit('frame', { direction: 'in', id, action, payload });
            void this.handleIncomingCall(id, action, payload);
            return;
        }
        if (frame[0] === MessageType.CALLRESULT) {
            const [, id, payload] = frame;
            const p = this.pending.get(id);
            if (!p) return;
            this.pending.delete(id);
            clearTimeout(p.timeout);
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
            const p = this.pending.get(id);
            if (!p) return;
            this.pending.delete(id);
            clearTimeout(p.timeout);
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
            throw new Error(`BootNotification rejected: ${res.status}`);
        }
        this.heartbeatIntervalSec = res.interval > 0 ? res.interval : 300;
        this.emit('booted', res);
    }

    private startHeartbeat(): void {
        this.heartbeat = setInterval(() => {
            this.call('Heartbeat', {}).catch((err) => this.emit('error', err));
        }, this.heartbeatIntervalSec * 1000);
    }

    // ---- helpers used by Simulator ----

    sendStatusNotification(connectorId: number, status: string, errorCode = 'NoError'): Promise<unknown> {
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

    stopTransaction(args: { transactionId: number; meterStop: number; reason: string; idTag?: string }): Promise<unknown> {
        return this.call('StopTransaction', {
            transactionId: args.transactionId,
            idTag: args.idTag,
            meterStop: args.meterStop,
            timestamp: new Date().toISOString(),
            reason: args.reason,
        });
    }

    sendMeterValue(connectorId: number, transactionId: number, energyWh: number, powerW: number): Promise<unknown> {
        return this.call('MeterValues', {
            connectorId,
            transactionId,
            meterValue: [
                {
                    timestamp: new Date().toISOString(),
                    sampledValue: [
                        { value: String(Math.round(energyWh)), measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
                        { value: String(Math.round(powerW)), measurand: 'Power.Active.Import', unit: 'W' },
                    ],
                },
            ],
        });
    }
}
