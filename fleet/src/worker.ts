/**
 * CP worker thread.
 *
 * Each worker holds exactly one OCPP WebSocket to the gateway,
 * driven by the existing single-CP runtime in backend/src/ocpp/*.
 * The supervisor talks to it over `parentPort` using the typed
 * Down/Up messages from `protocol.ts`.
 *
 * Lifecycle:
 *   spawn → wait for `init` → connect to gateway → emit `ready`
 *     → action loop (plug_in / start / stop / plug_out / e-stop)
 *     → `shutdown` → close WS → exit
 *
 * The worker keeps no business state of its own beyond what
 * ChargePoint + TransactionManager already track. The supervisor
 * is the source of truth for fleet-level state (group, lb cursor,
 * etc.); the worker is just a thin wrapper around the OCPP core.
 */

import { parentPort, threadId } from 'node:worker_threads';
import { ChargePoint } from '../../backend/src/ocpp/ChargePoint';
import { TransactionManager } from '../../backend/src/ocpp/TransactionManager';
import { AuthorizationManager } from '../../backend/src/ocpp/AuthorizationManager';
import {
    ChargePointConfiguration,
    ConnectorStatus,
} from '../../backend/src/models/Configuration';
import {
    DownMessage,
    UpMessage,
    isDownMessage,
} from './protocol';

if (!parentPort) {
    // The worker module imported standalone (e.g. by `node` directly)
    // is a misconfiguration — the supervisor always spawns it via
    // worker_threads. Fail loudly rather than silently no-oping.
    throw new Error('worker: parentPort is null — must be spawned via worker_threads');
}

const port = parentPort;

function send(msg: UpMessage): void {
    port.postMessage(msg);
}

function sendError(level: 'warn' | 'error', message: string): void {
    send({ type: 'error', level, message });
}

let chargePoint: ChargePoint | null = null;
let transactionManager: TransactionManager | null = null;
let cpId: string | null = null;

/**
 * Wire the events on the ChargePoint + TransactionManager so they
 * surface as UpMessages on the parent channel. The single-CP UI
 * subscribes to a similar set; this is the fleet flavour — same
 * facts, lower cardinality (no full OCPP frame, just the headlines).
 */
function wireEvents(cp: ChargePoint, tm: TransactionManager): void {
    cp.on('connected', () => send({ type: 'connected' }));
    cp.on('disconnected', () => send({ type: 'disconnected' }));
    cp.on('error', (err: Error) => sendError('error', err.message));

    // Per-connector status changes are inferred from the OCPP frames
    // the ChargePoint sends. The simplest reliable hook is the
    // `message` event with direction=outgoing and action=StatusNotification.
    cp.on('message', (m: { direction: string; data: unknown[] }) => {
        if (m.direction !== 'outgoing') return;
        const [, , action, payload] = m.data as [number, string, string, { connectorId?: number; status?: string }];
        if (action === 'StatusNotification' && payload && typeof payload.connectorId === 'number' && typeof payload.status === 'string') {
            send({ type: 'connector_status', connector_id: payload.connectorId, status: payload.status });
        }
    });

    tm.on('transactionStarted', (s: { connectorId: number; transactionId?: number; idTag: string }) => {
        if (typeof s.transactionId !== 'number') return;
        send({
            type: 'session_started',
            connector_id: s.connectorId,
            transaction_id: s.transactionId,
            id_tag: s.idTag,
        });
    });

    tm.on('transactionStopped', (s: { connectorId: number; transactionId?: number; energyKwh: number; powerKw: number }) => {
        if (typeof s.transactionId !== 'number') return;
        send({
            type: 'session_ended',
            connector_id: s.connectorId,
            transaction_id: s.transactionId,
            energy_wh: Math.round(s.energyKwh * 1000),
            peak_power_kw: s.powerKw,
            reason: 'Local',
        });
    });

    // Lightweight 1 Hz UI tick — much smaller than the OCPP MeterValues
    // frame the gateway sees. The supervisor decides whether to
    // forward this onto the UI pubsub channel; v1 just emits unconditionally.
    tm.on('sessionUpdated', (s: { connectorId: number; powerKw: number; energyKwh: number; socPercent?: number }) => {
        send({
            type: 'meter_tick',
            connector_id: s.connectorId,
            power_kw: s.powerKw,
            energy_kwh: s.energyKwh,
            soc_pct: s.socPercent,
        });
    });
}

async function handleInit(msg: Extract<DownMessage, { type: 'init' }>): Promise<void> {
    if (chargePoint) {
        sendError('warn', 'init received twice; ignoring');
        return;
    }
    cpId = msg.cp_id;

    const numberOfConnectors = msg.cp_type === 'DC' ? 2 : 1;
    const config: ChargePointConfiguration = {
        chargePointId: msg.cp_id,
        ocppServerUrl: msg.ocpp_url,
        maxPowerKw: msg.max_power_kw ?? (msg.cp_type === 'DC' ? 100 : 22),
        connectorType: msg.cp_type === 'DC' ? 'CCS' : 'Type2',
        voltage: msg.cp_type === 'DC' ? 400 : 400,
        maxCurrent: 32,
        numberOfConnectors,
        meterValueInterval: msg.meter_value_interval_s ?? 60,
        heartbeatInterval: msg.heartbeat_interval_s ?? 300,
    };

    const cp = new ChargePoint(config);
    const cm = cp.getConfigurationManager();
    const tm = new TransactionManager(cp, cm, msg.cp_id, config.maxPowerKw, config.meterValueInterval);
    const am = new AuthorizationManager(cp, cm, msg.cp_id);
    cp.setAuthorizationManager(am);
    tm.setAuthorizationManager(am);

    if (msg.phase_mode) {
        tm.setPhaseMode(1, msg.phase_mode);
    }
    if (msg.cp_type === 'DC') {
        tm.setConnectorType(1, 'DC');
        tm.setConnectorType(2, 'DC');
        if (msg.dc_profile) {
            tm.setDCProfile(1, msg.dc_profile);
            tm.setDCProfile(2, msg.dc_profile);
        }
    }

    wireEvents(cp, tm);

    chargePoint = cp;
    transactionManager = tm;

    // Connect; failures here aren't fatal — ChargePoint's reconnect
    // loop will retry every 5 s. The parent observes via `connected`/
    // `disconnected` UpMessages and never sees the catch.
    cp.connect().catch((err: Error) => {
        sendError('warn', `initial connect failed (will retry): ${err.message}`);
    });

    send({ type: 'ready' });
}

async function handlePlugIn(msg: Extract<DownMessage, { type: 'plug_in' }>): Promise<void> {
    if (!transactionManager) return sendError('error', 'plug_in before init');
    // Plug-in maps to a Preparing status; the ChargePoint surfaces it
    // automatically once startTransaction runs. For a true plug-then-
    // start UX we'd add a state machine here in MR-F; for MR-D
    // plug_in + start_charging is one step (start_charging issues
    // both the StatusNotification and the StartTransaction).
    sendError('warn', 'plug_in: noop in MR-D; use start_charging to begin a session');
    void msg;
}

async function handleStart(msg: Extract<DownMessage, { type: 'start_charging' }>, idTag: string): Promise<void> {
    if (!transactionManager) return sendError('error', 'start_charging before init');
    try {
        await transactionManager.startTransaction(msg.connector_id, idTag, false);
    } catch (err) {
        sendError('error', `start_charging failed: ${(err as Error).message}`);
    }
}

async function handleStop(msg: Extract<DownMessage, { type: 'stop_charging' }>): Promise<void> {
    if (!transactionManager) return sendError('error', 'stop_charging before init');
    try {
        await transactionManager.stopTransaction(msg.connector_id, msg.reason ?? 'Local');
    } catch (err) {
        sendError('error', `stop_charging failed: ${(err as Error).message}`);
    }
}

async function handleEmergencyStop(msg: Extract<DownMessage, { type: 'emergency_stop' }>): Promise<void> {
    if (!transactionManager) return sendError('error', 'emergency_stop before init');
    try {
        // OCPP convention: reason=EmergencyStop signals to the CSMS that
        // the session ended due to a safety event, not a normal user-driven
        // stop. The gateway / billing layer treats these differently.
        await transactionManager.stopTransaction(msg.connector_id, 'EmergencyStop');
    } catch (err) {
        sendError('error', `emergency_stop failed: ${(err as Error).message}`);
    }
}

async function handleShutdown(): Promise<void> {
    try {
        if (transactionManager) transactionManager.cleanup();
        if (chargePoint) chargePoint.disconnect();
    } catch (err) {
        sendError('warn', `shutdown error: ${(err as Error).message}`);
    } finally {
        // Give a tick for in-flight `up` messages to flush, then exit.
        setTimeout(() => process.exit(0), 50);
    }
}

// Track the most recent id_tag for start_charging; supervisor passes it
// in plug_in or as part of start_charging message? In v1 the start
// message takes the id_tag from the most recent plug_in payload kept
// here. Simpler than threading it through every message.
let pendingIdTag = 'TEST-TAG-001';

port.on('message', (raw: unknown) => {
    if (!isDownMessage(raw)) {
        sendError('warn', `dropped malformed Down message: ${JSON.stringify(raw)}`);
        return;
    }
    const msg = raw;
    switch (msg.type) {
        case 'init':
            void handleInit(msg);
            break;
        case 'plug_in':
            pendingIdTag = msg.id_tag;
            void handlePlugIn(msg);
            break;
        case 'start_charging':
            void handleStart(msg, pendingIdTag);
            break;
        case 'stop_charging':
            void handleStop(msg);
            break;
        case 'plug_out':
            // No-op until MR-F's plug-state machine; the OCPP layer
            // doesn't require a discrete plug-out beyond the status
            // notification that StopTransaction already triggers.
            break;
        case 'emergency_stop':
            void handleEmergencyStop(msg);
            break;
        case 'set_phase_mode':
            transactionManager?.setPhaseMode(1, msg.mode);
            break;
        case 'set_dc_profile':
            transactionManager?.setDCProfile(1, msg.profile);
            transactionManager?.setDCProfile(2, msg.profile);
            break;
        case 'shutdown':
            void handleShutdown();
            break;
    }
});

// Last-line-of-defense: a stray promise rejection inside the OCPP
// stack must not crash the worker silently — bubble it up to the
// supervisor so the supervisor can decide whether to respawn.
process.on('unhandledRejection', (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    sendError('error', `unhandled rejection in worker (cp_id=${cpId}, thread=${threadId}): ${message}`);
});
