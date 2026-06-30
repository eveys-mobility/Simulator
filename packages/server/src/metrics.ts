import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus registry + the metric set listed in the Phase 7a roadmap.
 *
 * **Cardinality discipline.** Labels are bounded — `device_type` is
 * AC|DC, `action` is the OCPP action name (~25 values), `direction`
 * is in|out, `frame_type` is CALL|CALLRESULT|CALLERROR. Nothing is
 * keyed by `device_id` or anything user-controlled, so the cardinality
 * stays predictable no matter how many devices exist.
 *
 * The single exception is reconnect counter — it ships *without* a
 * device label here for the same reason; if forensic per-device
 * reconnect counts are ever needed, they go in the per-frame event
 * store (Phase 7c), not Prom.
 */

export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: 'ocpp_sim_' });

const ns = 'ocpp_';

export const ocppCallTotal = new Counter({
    name: `${ns}call_total`,
    help: 'OCPP CALL frames sent or received, by action and direction',
    labelNames: ['action', 'direction', 'device_type'] as const,
    registers: [registry],
});

export const ocppCallLatencySeconds = new Histogram({
    name: `${ns}call_latency_seconds`,
    help: 'Round-trip latency of outgoing OCPP CALLs (request → CALLRESULT)',
    labelNames: ['action', 'device_type'] as const,
    // Boot/Authorize/StartTransaction can be slow on first connect; meter
    // values should be sub-second. Buckets cover both regimes.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
});

export const ocppCallErrorsTotal = new Counter({
    name: `${ns}call_errors_total`,
    help: 'OCPP CALLs that ended in CALLERROR or timeout',
    labelNames: ['action', 'error_code'] as const,
    registers: [registry],
});

export const ocppFramesTotal = new Counter({
    name: `${ns}frames_total`,
    help: 'OCPP frames seen on the wire',
    labelNames: ['direction', 'frame_type'] as const,
    registers: [registry],
});

export const ocppActiveDevices = new Gauge({
    name: `${ns}active_devices`,
    help: 'Number of devices in each connection state',
    labelNames: ['state'] as const,
    registers: [registry],
});

export const ocppActiveSessions = new Gauge({
    name: `${ns}active_sessions`,
    help: 'Number of currently-active charging sessions',
    labelNames: ['device_type'] as const,
    registers: [registry],
});

export const ocppSessionDurationSeconds = new Histogram({
    name: `${ns}session_duration_seconds`,
    help: 'Duration of completed charging sessions',
    labelNames: ['device_type', 'end_reason'] as const,
    // From very short test taps to multi-hour fleet runs.
    buckets: [10, 30, 60, 300, 900, 1800, 3600, 7200, 14400, 28800],
    registers: [registry],
});

export const ocppSessionEnergyWh = new Histogram({
    name: `${ns}session_energy_wh`,
    help: 'Energy delivered per completed session (Wh)',
    labelNames: ['device_type'] as const,
    buckets: [10, 100, 1000, 5000, 10000, 25000, 50000, 100000],
    registers: [registry],
});

export const ocppWsReconnectsTotal = new Counter({
    name: `${ns}ws_reconnects_total`,
    help: 'WebSocket reconnect attempts after an unintended close',
    labelNames: [] as const,
    registers: [registry],
});

export const ocppBootLatencySeconds = new Histogram({
    name: `${ns}boot_latency_seconds`,
    help: 'BootNotification CALL → first Accepted CALLRESULT latency',
    labelNames: ['device_type'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
});

export const simTickLagSeconds = new Gauge({
    name: 'sim_tick_lag_seconds',
    help: 'Drift of the per-second simulation tick from its nominal cadence',
    labelNames: [] as const,
    registers: [registry],
});

/** Render the registry to Prometheus text format. */
export function renderMetrics(): Promise<string> {
    return registry.metrics();
}

/** Test-only: reset all counters/gauges/histograms to zero. */
export function resetMetrics(): void {
    registry.resetMetrics();
}
