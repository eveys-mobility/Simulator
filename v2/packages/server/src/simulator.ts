import { EventEmitter } from 'node:events';
import {
    type ConnectorStatus,
    DEFAULT_DC_PROFILE,
    type Device,
    type MeterTick,
    sim,
} from '@ocpp-sim/core';
import { OcppClient } from './ocpp-client.js';

interface ConnectorState {
    status: ConnectorStatus;
    transactionId: number | null;
    sessionRowId: number | null;
    idTag: string | null;
    energyWh: number;
    peakPowerW: number;
    startedAtMs: number;
    tickTimer: NodeJS.Timeout | null;
}

/**
 * Per-device runtime. Owns:
 *  - one OCPP client (gateway WS)
 *  - per-connector state machine (Available → Preparing → Charging → Finishing)
 *  - the 1 Hz tick loop that produces meter values + UI ticks while charging
 *
 * Emits:
 *  - 'state'       device-level online/offline + connector-status changes
 *  - 'tick'        per-second meter tick (UI live updates)
 *  - 'session'     start / stop events with the persisted Session row id
 *  - 'frame'       raw OCPP frames in/out (debug)
 */
export class Simulator extends EventEmitter {
    private client: OcppClient;
    private connectors: Map<number, ConnectorState> = new Map();

    constructor(public readonly device: Device) {
        super();
        const numConnectors = device.type === 'DC' ? 2 : 1;
        for (let id = 1; id <= numConnectors; id++) {
            this.connectors.set(id, {
                status: 'Available',
                transactionId: null,
                sessionRowId: null,
                idTag: null,
                energyWh: 0,
                peakPowerW: 0,
                startedAtMs: 0,
                tickTimer: null,
            });
        }
        this.client = new OcppClient(device);
        this.client.on('online', () => this.handleOnline());
        this.client.on('offline', () => this.emit('state', { online: false }));
        this.client.on('booted', () => this.emit('state', { online: true }));
        this.client.on('frame', (f) => this.emit('frame', f));
        this.client.on('error', (e) => this.emit('error', e));
    }

    async start(): Promise<void> {
        await this.client.start();
    }

    stop(): void {
        for (const c of this.connectors.values()) {
            if (c.tickTimer) clearInterval(c.tickTimer);
        }
        this.client.stop();
    }

    snapshot(): {
        online: boolean;
        connectors: { id: number; status: ConnectorStatus; transactionId: number | null }[];
    } {
        return {
            online: this.client.isOnline(),
            connectors: [...this.connectors.entries()].map(([id, c]) => ({
                id,
                status: c.status,
                transactionId: c.transactionId,
            })),
        };
    }

    async startSession(connectorId: number, idTag: string, sessionRowId: number): Promise<number> {
        const c = this.requireConnector(connectorId);
        if (c.transactionId) throw new Error(`connector ${connectorId} already has an active transaction`);
        if (!this.client.isOnline()) throw new Error('device offline; cannot start session');
        await this.setStatus(connectorId, 'Preparing');
        const res = await this.client.startTransaction({ connectorId, idTag, meterStart: 0 });
        c.transactionId = res.transactionId;
        c.idTag = idTag;
        c.sessionRowId = sessionRowId;
        c.energyWh = 0;
        c.peakPowerW = 0;
        c.startedAtMs = Date.now();
        await this.setStatus(connectorId, 'Charging');
        c.tickTimer = setInterval(() => this.tick(connectorId), 1000);
        this.emit('session', { type: 'started', connectorId, transactionId: res.transactionId, idTag, sessionRowId });
        return res.transactionId;
    }

    async stopSession(connectorId: number, reason = 'Local'): Promise<{
        sessionRowId: number;
        energyWh: number;
        peakPowerKw: number;
    }> {
        const c = this.requireConnector(connectorId);
        if (!c.transactionId || c.sessionRowId === null) {
            throw new Error(`connector ${connectorId} has no active transaction`);
        }
        if (c.tickTimer) clearInterval(c.tickTimer);
        c.tickTimer = null;
        const tx = c.transactionId;
        const sessionRowId = c.sessionRowId;
        const energyWh = Math.round(c.energyWh);
        const peakPowerKw = c.peakPowerW / 1000;
        await this.setStatus(connectorId, 'Finishing');
        try {
            await this.client.stopTransaction({ transactionId: tx, meterStop: energyWh, reason, idTag: c.idTag ?? undefined });
        } catch (err) {
            this.emit('error', err);
        }
        c.transactionId = null;
        c.sessionRowId = null;
        c.idTag = null;
        c.energyWh = 0;
        c.peakPowerW = 0;
        await this.setStatus(connectorId, 'Available');
        this.emit('session', { type: 'stopped', connectorId, transactionId: tx, sessionRowId, energyWh, peakPowerKw, reason });
        return { sessionRowId, energyWh, peakPowerKw };
    }

    private async handleOnline(): Promise<void> {
        // Send Available StatusNotifications for every connector after boot.
        for (const id of this.connectors.keys()) {
            try {
                await this.client.sendStatusNotification(id, 'Available');
            } catch (err) {
                this.emit('error', err);
            }
        }
    }

    private async setStatus(connectorId: number, status: ConnectorStatus): Promise<void> {
        const c = this.requireConnector(connectorId);
        c.status = status;
        this.emit('state', { connectorId, status });
        if (this.client.isOnline()) {
            try {
                await this.client.sendStatusNotification(connectorId, status);
            } catch (err) {
                this.emit('error', err);
            }
        }
    }

    private requireConnector(id: number): ConnectorState {
        const c = this.connectors.get(id);
        if (!c) throw new Error(`device ${this.device.id} has no connector ${id}`);
        return c;
    }

    private tick(connectorId: number): void {
        const c = this.requireConnector(connectorId);
        if (!c.transactionId) return;

        const t = (Date.now() - c.startedAtMs) / 1000;
        let powerW = 0;
        let socPct: number | undefined;
        if (this.device.type === 'DC') {
            const profile = this.device.dcProfile ?? DEFAULT_DC_PROFILE;
            const f = sim.computeDCFrame(profile, t, c.energyWh);
            powerW = f.powerW;
            socPct = f.socPct;
            if (f.completed) {
                // Battery full → end session automatically.
                this.stopSession(connectorId, 'Local').catch((e) => this.emit('error', e));
                return;
            }
        } else {
            const f = sim.computePhaseFrame(this.device.maxPowerKw, this.device.phaseMode);
            powerW = f.totalKw * 1000;
        }
        // Energy = ∫ P dt; the tick is 1 s, so add P (W) * 1/3600 hours = Wh.
        c.energyWh += powerW / 3600;
        if (powerW > c.peakPowerW) c.peakPowerW = powerW;

        const tick: MeterTick = {
            deviceId: this.device.id,
            connectorId,
            powerKw: powerW / 1000,
            energyKwh: c.energyWh / 1000,
            socPct,
        };
        this.emit('tick', tick);

        // Push MeterValues to gateway every ~60s, fire-and-forget.
        const seconds = Math.floor(t);
        if (seconds > 0 && seconds % 60 === 0) {
            this.client.sendMeterValue(connectorId, c.transactionId, c.energyWh, powerW).catch((e) => this.emit('error', e));
        }
    }
}
