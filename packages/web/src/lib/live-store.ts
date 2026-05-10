import type { BenchmarkProgress, ConnectorStatus, MeterTick } from '@ocpp-sim/core';
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
    /** Latest progress sample per benchmark runId, keyed numerically. */
    benchmarkProgress: Map<number, BenchmarkProgress>;
    /** Server-side coalescing telemetry. Per-device so a burst on
     *  Device B doesn't make Device A's trace viewer flash "throttled".
     *  Total + last-sample fields are kept for a fleet-wide indicator
     *  if we ever add one. */
    coalesce: {
        totalDropped: number;
        lastSampleAt: number;
        lastWindowDropped: number;
        byDevice: Map<string, { lastSampleAt: number; lastWindow: number; total: number }>;
    };
    setBenchmarkProgress: (p: BenchmarkProgress) => void;
    setOnline: (deviceId: string, online: boolean) => void;
    setConnectorStatus: (deviceId: string, connectorId: number, status: ConnectorStatus) => void;
    applyTick: (t: MeterTick) => void;
    appendFrame: (e: Omit<TraceEntry, 'seq'>) => void;
    recordCoalescedDrop: (sample: { total: number; byDevice: Record<string, number> }) => void;
    clearTraces: (deviceId: string) => void;
    reset: (deviceId: string) => void;
    /** Drop every map entry whose deviceId isn't in `keep`. Called from
     *  the WS hello snapshot and after device deletions so the maps
     *  stay bounded under bulk-create/delete cycles. */
    evictMissing: (keep: Set<string>) => void;
}

export const useLiveStore = create<LiveState>((set) => ({
    online: new Map(),
    connectorStatus: new Map(),
    tick: new Map(),
    traces: new Map(),
    nextTraceSeq: 0,
    benchmarkProgress: new Map(),
    coalesce: { totalDropped: 0, lastSampleAt: 0, lastWindowDropped: 0, byDevice: new Map() },

    setBenchmarkProgress: (p) =>
        set((s) => {
            const next = new Map(s.benchmarkProgress);
            next.set(p.runId, p);
            return { benchmarkProgress: next };
        }),

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

    recordCoalescedDrop: (sample) =>
        set((s) => {
            const now = Date.now();
            const byDevice = new Map(s.coalesce.byDevice);
            for (const [id, count] of Object.entries(sample.byDevice)) {
                const prev = byDevice.get(id);
                byDevice.set(id, {
                    lastSampleAt: now,
                    lastWindow: count,
                    total: (prev?.total ?? 0) + count,
                });
            }
            return {
                coalesce: {
                    totalDropped: s.coalesce.totalDropped + sample.total,
                    lastSampleAt: now,
                    lastWindowDropped: sample.total,
                    byDevice,
                },
            };
        }),

    clearTraces: (deviceId) =>
        set((s) => {
            const next = new Map(s.traces);
            next.set(deviceId, []);
            return { traces: next };
        }),

    reset: (deviceId) =>
        set((s) => {
            const on = new Map(s.online);
            const cs = new Map(s.connectorStatus);
            const tk = new Map(s.tick);
            const tr = new Map(s.traces);
            const cb = new Map(s.coalesce.byDevice);
            on.delete(deviceId);
            for (const k of [...cs.keys()]) if (k.startsWith(`${deviceId}:`)) cs.delete(k);
            for (const k of [...tk.keys()]) if (k.startsWith(`${deviceId}:`)) tk.delete(k);
            tr.delete(deviceId);
            cb.delete(deviceId);
            return {
                online: on,
                connectorStatus: cs,
                tick: tk,
                traces: tr,
                coalesce: { ...s.coalesce, byDevice: cb },
            };
        }),

    evictMissing: (keep) =>
        set((s) => {
            // Bail when nothing changed — avoids forcing every component
            // that subscribes to one of these Maps to re-render on a
            // routine REST refetch where the device set didn't move.
            const onlineMissing = [...s.online.keys()].filter((id) => !keep.has(id));
            const tracesMissing = [...s.traces.keys()].filter((id) => !keep.has(id));
            const connStatusMissing = [...s.connectorStatus.keys()].filter(
                (k) => !keep.has(k.split(':')[0] ?? ''),
            );
            const tickMissing = [...s.tick.keys()].filter(
                (k) => !keep.has(k.split(':')[0] ?? ''),
            );
            const coalesceMissing = [...s.coalesce.byDevice.keys()].filter((id) => !keep.has(id));
            if (
                onlineMissing.length === 0 &&
                tracesMissing.length === 0 &&
                connStatusMissing.length === 0 &&
                tickMissing.length === 0 &&
                coalesceMissing.length === 0
            ) {
                return {};
            }
            const on = new Map(s.online);
            const cs = new Map(s.connectorStatus);
            const tk = new Map(s.tick);
            const tr = new Map(s.traces);
            const cb = new Map(s.coalesce.byDevice);
            for (const id of onlineMissing) on.delete(id);
            for (const id of tracesMissing) tr.delete(id);
            for (const k of connStatusMissing) cs.delete(k);
            for (const k of tickMissing) tk.delete(k);
            for (const id of coalesceMissing) cb.delete(id);
            return {
                online: on,
                connectorStatus: cs,
                tick: tk,
                traces: tr,
                coalesce: { ...s.coalesce, byDevice: cb },
            };
        }),
}));

export const liveKey = (deviceId: string, connectorId: number) => `${deviceId}:${connectorId}`;
