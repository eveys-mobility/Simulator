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

export interface TraceEntry {
    /** Monotonic local id. Pubsub frames don't carry their own ordinal,
     *  and the OCPP message-id only correlates a CALL with its
     *  CALLRESULT — not a global stream order. The store assigns this. */
    seq: number;
    deviceId: string;
    direction: 'in' | 'out';
    /** OCPP action name. For CALLRESULT/CALLERROR the server reports
     *  the action of the matched original CALL. */
    action: string;
    /** OCPP message id (uuid string). */
    id: string;
    /** Wall-clock ms when the server saw the frame. */
    at: number;
    payload: unknown;
}

const TRACE_LIMIT = 500;

interface LiveState {
    online: Map<string, boolean>;
    connectorStatus: Map<string, ConnectorStatus>; // key = `${deviceId}:${connectorId}`
    tick: Map<string, LiveTick>; // same key
    /** Per-device ring buffer of OCPP frames, capped at TRACE_LIMIT.
     *  Cheap: clones the slice on push, but slice cost is O(limit) and
     *  fires at OCPP rate (≪10/s), not React render rate. */
    traces: Map<string, TraceEntry[]>;
    nextTraceSeq: number;
    setOnline: (deviceId: string, online: boolean) => void;
    setConnectorStatus: (deviceId: string, connectorId: number, status: ConnectorStatus) => void;
    applyTick: (t: MeterTick) => void;
    appendFrame: (e: Omit<TraceEntry, 'seq'>) => void;
    clearTraces: (deviceId: string) => void;
    reset: (deviceId: string) => void;
}

export const useLiveStore = create<LiveState>((set) => ({
    online: new Map(),
    connectorStatus: new Map(),
    tick: new Map(),
    traces: new Map(),
    nextTraceSeq: 0,

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

    appendFrame: (e) =>
        set((s) => {
            const seq = s.nextTraceSeq + 1;
            const entry: TraceEntry = { seq, ...e };
            const next = new Map(s.traces);
            const existing = next.get(e.deviceId) ?? [];
            const updated =
                existing.length >= TRACE_LIMIT
                    ? [...existing.slice(existing.length - TRACE_LIMIT + 1), entry]
                    : [...existing, entry];
            next.set(e.deviceId, updated);
            return { traces: next, nextTraceSeq: seq };
        }),

    clearTraces: (deviceId) =>
        set((s) => {
            const next = new Map(s.traces);
            next.set(deviceId, []);
            return { traces: next };
        }),

    reset: (deviceId) =>
        set((s) => {
            const cs = new Map(s.connectorStatus);
            const tk = new Map(s.tick);
            const tr = new Map(s.traces);
            for (const k of [...cs.keys()]) if (k.startsWith(`${deviceId}:`)) cs.delete(k);
            for (const k of [...tk.keys()]) if (k.startsWith(`${deviceId}:`)) tk.delete(k);
            tr.delete(deviceId);
            return { connectorStatus: cs, tick: tk, traces: tr };
        }),
}));

export const liveKey = (deviceId: string, connectorId: number) => `${deviceId}:${connectorId}`;
