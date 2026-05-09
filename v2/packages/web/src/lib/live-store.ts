import type { ConnectorStatus, MeterTick } from '@ocpp-sim/core';
import { create } from 'zustand';

/**
 * Live store fed by the server's WebSocket. Holds *only* facts the
 * server pushes after the initial REST snapshot:
 *  - per-device online/offline
 *  - per-connector status
 *  - per-connector live tick (kW, kWh, SoC)
 *
 * Static device fields (id, displayName, type, model) are NOT in
 * here — those come from TanStack Query caches keyed on the REST
 * endpoint and never change at runtime, so the UI reads them
 * separately and there's no chance of an old WS frame stomping the
 * device's identity. This is the architectural fix for the AC↔DC
 * flicker the v1 frontend had.
 */

export interface LiveTick {
    powerKw: number;
    energyKwh: number;
    socPct?: number;
    at: number;
}

interface LiveState {
    online: Map<string, boolean>;
    connectorStatus: Map<string, ConnectorStatus>; // key = `${deviceId}:${connectorId}`
    tick: Map<string, LiveTick>; // same key
    setOnline: (deviceId: string, online: boolean) => void;
    setConnectorStatus: (deviceId: string, connectorId: number, status: ConnectorStatus) => void;
    applyTick: (t: MeterTick) => void;
    reset: (deviceId: string) => void;
}

export const useLiveStore = create<LiveState>((set) => ({
    online: new Map(),
    connectorStatus: new Map(),
    tick: new Map(),

    setOnline: (deviceId, online) =>
        set((s) => {
            const next = new Map(s.online);
            next.set(deviceId, online);
            return { online: next };
        }),

    setConnectorStatus: (deviceId, connectorId, status) =>
        set((s) => {
            const next = new Map(s.connectorStatus);
            next.set(`${deviceId}:${connectorId}`, status);
            return { connectorStatus: next };
        }),

    applyTick: (t) =>
        set((s) => {
            const next = new Map(s.tick);
            next.set(`${t.deviceId}:${t.connectorId}`, {
                powerKw: t.powerKw,
                energyKwh: t.energyKwh,
                socPct: t.socPct,
                at: Date.now(),
            });
            return { tick: next };
        }),

    reset: (deviceId) =>
        set((s) => {
            const cs = new Map(s.connectorStatus);
            const tk = new Map(s.tick);
            for (const k of [...cs.keys()]) if (k.startsWith(`${deviceId}:`)) cs.delete(k);
            for (const k of [...tk.keys()]) if (k.startsWith(`${deviceId}:`)) tk.delete(k);
            return { connectorStatus: cs, tick: tk };
        }),
}));

export const liveKey = (deviceId: string, connectorId: number) => `${deviceId}:${connectorId}`;
