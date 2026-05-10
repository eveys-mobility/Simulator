import { EventEmitter } from 'node:events';
import {
    CancelReservationReqSchema,
    type CancelReservationStatus,
    type ChargingProfile,
    ChargingProfileSchema,
    ClearChargingProfileReqSchema,
    type ConnectorStatus,
    DEFAULT_AC_WIRING,
    DEFAULT_DC_PROFILE,
    type Device,
    type DiagnosticsStatus,
    type FirmwareStatus,
    GetCompositeScheduleReqSchema,
    GetDiagnosticsReqSchema,
    type MeterTick,
    type Reservation,
    ReserveNowReqSchema,
    type ReserveNowStatus,
    SendLocalListReqSchema,
    SetChargingProfileReqSchema,
    UpdateFirmwareReqSchema,
    type UpdateStatus,
    composeSchedule,
    resolveActiveLimit,
    sim,
} from '@ocpp-sim/core';
import {
    ocppActiveSessions,
    ocppSessionDurationSeconds,
    ocppSessionEnergyWh,
    simTickLagSeconds,
} from './metrics.js';
import { type IncomingCallResult, OcppClient, type OcppClientOptions } from './ocpp-client.js';
import { OcppConfig } from './ocpp-config.js';
import type { Store } from './store.js';

interface ConnectorState {
    status: ConnectorStatus;
    transactionId: number | null;
    sessionRowId: number | null;
    idTag: string | null;
    energyWh: number;
    peakPowerW: number;
    startedAtMs: number;
    tickTimer: NodeJS.Timeout | null;
    /** Operational state, decoupled from OCPP status. ChangeAvailability
     *  Inoperative blocks new sessions but the connector still reports
     *  status. Modeled as a flag, not a status — so a faulted connector
     *  is also unavailable. */
    operative: boolean;
    /** Whether a cable is currently plugged into the connector. The
     *  default is unplugged (Available). plug-in moves to Preparing;
     *  start_charging without plug-in implicitly plugs first. */
    pluggedIn: boolean;
    /** Pending fault auto-clear timer (set when a fault was injected
     *  with `clear_after_seconds`). Cleared on manual clear or shutdown. */
    faultClearTimer: NodeJS.Timeout | null;
    /** Active reservation (§6.18). Null means the connector is free
     *  for any idTag. Holding a reservation flips StatusNotification
     *  to "Reserved" and rejects RemoteStart from any other tag. */
    reservation: Reservation | null;
    /** One-shot timer that fires at `expiryDate` and releases the
     *  reservation. Cleared on cancel / consume / shutdown. */
    reservationExpiryTimer: NodeJS.Timeout | null;
    /** OCPP §9.1.5 ConnectionTimeOut: how long the CP stays in
     *  Preparing before reverting to Available when no plug-in /
     *  session start follows. Armed when status flips *to* Preparing,
     *  cleared when it flips away or on shutdown. */
    connectionTimeoutTimer: NodeJS.Timeout | null;
}

/**
 * Recompute a DC measurand set after a SmartCharging cap reduced the
 * frame's powerW. The SoC curve already gave us voltage and SoC; the
 * cap only changes the realized power, current, and (over time) the
 * energy delta. Lives at module scope so it can be tested separately
 * if we ever need to.
 */
function recomputeDcMeasurands(
    energyWh: number,
    powerW: number,
    voltageV: number,
    socPct: number,
): sim.SampledValue[] {
    const currentA = voltageV > 0 ? powerW / voltageV : 0;
    return [
        { measurand: 'Energy.Active.Import.Register', value: String(Math.round(energyWh)), unit: 'Wh', location: 'Outlet' },
        { measurand: 'Power.Active.Import', value: String(Math.round(powerW)), unit: 'W', location: 'Outlet' },
        { measurand: 'Voltage', value: voltageV.toFixed(1), unit: 'V' },
        { measurand: 'Current.Import', value: currentA.toFixed(2), unit: 'A' },
        { measurand: 'SoC', value: socPct.toFixed(1), unit: 'Percent', location: 'EV' },
    ];
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
    private config: OcppConfig;
    /** SessionRowId allocator — the API layer hands us the persisted row
     *  id when it starts a session it initiated. For sessions we open
     *  ourselves (RemoteStartTransaction), we need someone to persist
     *  the row first. The store is injected so we can do that inline. */
    private store: Store;
    /** Firmware state walked by UpdateFirmware: the latest status the
     *  simulator emitted on FirmwareStatusNotification. Idle is the
     *  resting state; the rest are transient and announce progress. */
    private firmwareStatus: FirmwareStatus = 'Idle';
    /** Diagnostics upload state walked by GetDiagnostics. Same shape. */
    private diagnosticsStatus: DiagnosticsStatus = 'Idle';
    /** Live state-machine timers; cleared on stop() to avoid leaking
     *  setTimeouts across despawns. */
    private firmwareTimers: NodeJS.Timeout[] = [];
    private diagnosticsTimers: NodeJS.Timeout[] = [];
    /** Set in stop() so any timer that already had its handler queued
     *  before clearInterval/clearTimeout ran can short-circuit. Without
     *  this, a tick fired after stop() reaches into a closed Store and
     *  crashes — visible under the conformance suite where cases run
     *  back-to-back. */
    private stopped = false;

    constructor(public readonly device: Device, store: Store, clientOptions: OcppClientOptions = {}) {
        super();
        this.store = store;
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
                operative: true,
                pluggedIn: false,
                faultClearTimer: null,
                reservation: null,
                reservationExpiryTimer: null,
                connectionTimeoutTimer: null,
            });
        }
        this.config = new OcppConfig(store, device.id, numConnectors);
        // Effects: keep the OcppClient's heartbeat in sync with the
        // CSMS-writable HeartbeatInterval. Other effects (meter cadence,
        // etc.) read the value lazily from `this.config` on each tick.
        this.config.onChange((key, value) => {
            if (key === 'HeartbeatInterval') {
                const seconds = Number(value);
                if (Number.isFinite(seconds) && seconds > 0) {
                    this.client.setHeartbeatIntervalSec(seconds);
                }
            }
        });
        this.client = new OcppClient(device, clientOptions);
        this.client.setIncomingHandler((action, payload) => this.handleCsmsCall(action, payload));
        // 'online' fires the moment the WS opens — but per OCPP §4.2 we
        // must NOT send anything other than BootNotification until the
        // CSMS Accepts. The Status fan-out and live-state flip both wait
        // for 'booted' below.
        this.client.on('offline', () => this.emit('state', { online: false }));
        this.client.on('booted', () => {
            // Apply any persisted heartbeat-interval override now that we're connected.
            const hb = this.config.getNumber('HeartbeatInterval');
            if (hb && hb > 0) this.client.setHeartbeatIntervalSec(hb);
            this.emit('state', { online: true });
            void this.handleOnline();
        });
        this.client.on('frame', (f) => this.emit('frame', f));
        this.client.on('error', (e) => this.emit('error', e));
    }

    async start(): Promise<void> {
        await this.client.start();
    }

    stop(): void {
        this.stopped = true;
        for (const c of this.connectors.values()) {
            if (c.tickTimer) clearInterval(c.tickTimer);
            if (c.faultClearTimer) clearTimeout(c.faultClearTimer);
            if (c.reservationExpiryTimer) clearTimeout(c.reservationExpiryTimer);
            if (c.connectionTimeoutTimer) clearTimeout(c.connectionTimeoutTimer);
        }
        this.clearFirmwareTimers();
        this.clearDiagnosticsTimers();
        this.client.stop();
    }

    /**
     * Set a single OCPP configuration key. Returns the wire-status the
     * CSMS would receive (Accepted / Rejected / NotSupported / RebootRequired).
     * Used by fleet bulk-config endpoints; the listener inside the
     * Simulator picks up effects (heartbeat cadence, etc.) the same way
     * a real ChangeConfiguration would.
     */
    setOcppConfig(key: string, value: string): 'Accepted' | 'Rejected' | 'NotSupported' | 'RebootRequired' {
        return this.config.set(key, value);
    }

    /**
     * OCPP `GetConfiguration` payload for the device. Pass `keys =
     * undefined` to dump every key (what most operators want from a
     * UI); a subset matches the wire semantics the CSMS uses.
     */
    getOcppConfig(keys?: string[]): {
        configurationKey: { key: string; readonly: boolean; value?: string }[];
        unknownKey: string[];
    } {
        return this.config.getMany(keys);
    }

    /**
     * Apply a device-edit patch to the running Simulator without
     * respawning the OCPP socket. Used for fields whose change can be
     * picked up on the next tick (phaseMode, acWiring, dcProfile,
     * displayName) — anything that requires a new BootNotification
     * still goes through `DeviceManager.respawn`.
     */
    applyDeviceEdit(
        patch: Partial<Pick<Device, 'displayName' | 'phaseMode' | 'acWiring' | 'dcProfile'>>,
    ): void {
        if (patch.displayName !== undefined) this.device.displayName = patch.displayName;
        if (patch.phaseMode !== undefined) this.device.phaseMode = patch.phaseMode;
        if (patch.acWiring !== undefined) this.device.acWiring = patch.acWiring;
        if (patch.dcProfile !== undefined) this.device.dcProfile = patch.dcProfile;
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
        if (!c.operative) throw new Error(`connector ${connectorId} is Inoperative`);
        if (!this.client.isOnline()) throw new Error('device offline; cannot start session');
        // §5.5 ConcurrentTx: same idTag can only be on one active
        // session per device. Catches the operator-driven path that
        // bypasses RemoteStart's pre-check.
        if (this.isIdTagAlreadyActive(idTag, connectorId)) {
            throw new Error(
                `idTag ${idTag} is already on an active session — concurrent transactions refused`,
            );
        }
        // §6.18: a reserved connector only accepts the bound idTag.
        // Any other tag must be refused — the operator's swipe stays
        // a swipe, not a reservation hijack.
        if (c.reservation && c.reservation.idTag !== idTag) {
            throw new Error(
                `connector ${connectorId} is reserved for idTag ${c.reservation.idTag}`,
            );
        }
        // Matching idTag → consume the reservation. The status flip
        // below moves us out of Reserved into Preparing/Charging.
        if (c.reservation) {
            this.releaseReservation(connectorId, /*restoreStatus*/ false);
        }
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
        ocppActiveSessions.inc({ device_type: this.device.type });
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
        const durationSec = (Date.now() - c.startedAtMs) / 1000;
        ocppActiveSessions.dec({ device_type: this.device.type });
        ocppSessionDurationSeconds.observe({ device_type: this.device.type, end_reason: reason }, durationSec);
        ocppSessionEnergyWh.observe({ device_type: this.device.type }, energyWh);
        await this.setStatus(connectorId, 'Finishing');
        // Skip the StopTransaction CALL when offline — the CSMS isn't
        // there to receive it, and a long-pending CALL would block the
        // delete path. The session row still gets ended via the
        // 'session: stopped' event so audit history stays correct.
        if (this.client.isOnline()) {
            try {
                await this.client.stopTransaction({ transactionId: tx, meterStop: energyWh, reason, idTag: c.idTag ?? undefined });
            } catch (err) {
                this.emit('error', err);
            }
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

    // ---- Manual / physical actions ----
    //
    // These model what a person does at a real charger: plug the cable
    // in, swipe a card, hit the emergency-stop button. They drive the
    // same OCPP semantics the CSMS-initiated equivalents do, but the
    // intent is local-control, surfaced from the UI for testing.

    /** Move connector Available → Preparing and report it to the gateway.
     *  No-op if a session is already running on that connector. */
    async plugIn(connectorId: number): Promise<void> {
        const c = this.requireConnector(connectorId);
        if (c.transactionId !== null) return;
        if (!c.operative) throw new Error(`connector ${connectorId} is Inoperative`);
        if (c.status === 'Faulted') throw new Error(`connector ${connectorId} is Faulted`);
        if (c.pluggedIn) return;
        c.pluggedIn = true;
        await this.setStatus(connectorId, 'Preparing');
    }

    /** Pull the cable. Without an active session this returns the
     *  connector to Available. With one, it ends the session with
     *  reason=EVDisconnected (matches OCPP 1.6 §6.20). */
    async plugOut(connectorId: number): Promise<void> {
        const c = this.requireConnector(connectorId);
        if (c.transactionId !== null) {
            await this.stopSession(connectorId, 'EVDisconnected');
            c.pluggedIn = false;
            return;
        }
        c.pluggedIn = false;
        if (c.status === 'Preparing') {
            await this.setStatus(connectorId, 'Available');
        }
    }

    /**
     * RFID swipe: Authorize the tag with the gateway, and on Accepted
     * either start (if no session) or stop (if same tag's session is
     * running) — that's what real chargers do with a single button/tap.
     * Returns the resulting `Authorize` idTagInfo status so the caller
     * can react.
     */
    async swipeCard(connectorId: number, idTag: string): Promise<'started' | 'stopped' | 'rejected'> {
        const c = this.requireConnector(connectorId);
        if (!this.client.isOnline()) throw new Error('device offline');

        const auth = (await this.client
            .call('Authorize', { idTag })
            .catch(() => ({ idTagInfo: { status: 'Invalid' } }))) as {
            idTagInfo: { status: string };
        };
        if (auth.idTagInfo.status !== 'Accepted') return 'rejected';

        if (c.transactionId !== null) {
            // Same-tag swipe ends the session; different-tag is a no-op
            // here (real chargers commonly require admin override). Keep
            // it simple: any accepted swipe stops a running session.
            await this.stopSession(connectorId, 'Local');
            return 'stopped';
        }

        // Open a session, persisting the row first so RemoteStart and
        // manual swipe share the same row-id flow.
        if (!c.pluggedIn) await this.plugIn(connectorId);
        const sessionRowId = this.store.insertSession({
            deviceId: this.device.id,
            connectorId,
            transactionId: 0,
            idTag,
            status: 'active',
            startedAt: new Date().toISOString(),
            endedAt: null,
            endReason: null,
            energyWh: 0,
            peakPowerKw: 0,
        });
        try {
            const txId = await this.startSession(connectorId, idTag, sessionRowId);
            this.store.db
                .prepare(`UPDATE sessions SET transaction_id = ? WHERE id = ?`)
                .run(txId, sessionRowId);
            return 'started';
        } catch (err) {
            this.store.endSession({
                id: sessionRowId,
                endedAt: new Date().toISOString(),
                endReason: 'aborted',
                energyWh: 0,
                peakPowerKw: 0,
            });
            throw err;
        }
    }

    /**
     * Inject a fault on a connector. Optional `clearAfterSeconds` schedules
     * an auto-clear back to Available. If a session is active, it's stopped
     * with the given `stopReason` (default `PowerLoss`) before the connector
     * flips to Faulted.
     */
    async injectFault(args: {
        connectorId: number;
        errorCode?: string;
        clearAfterSeconds?: number;
        stopReason?: string;
    }): Promise<void> {
        const { connectorId, errorCode = 'OtherError', clearAfterSeconds, stopReason = 'PowerLoss' } = args;
        const c = this.requireConnector(connectorId);
        if (c.faultClearTimer) {
            clearTimeout(c.faultClearTimer);
            c.faultClearTimer = null;
        }
        if (c.transactionId !== null) {
            await this.stopSession(connectorId, stopReason);
        }
        c.status = 'Faulted';
        this.emit('state', { connectorId, status: 'Faulted' });
        if (this.client.isOnline()) {
            try {
                await this.client.sendStatusNotification(connectorId, 'Faulted', errorCode);
            } catch (err) {
                this.emit('error', err);
            }
        }
        if (typeof clearAfterSeconds === 'number' && clearAfterSeconds > 0) {
            c.faultClearTimer = setTimeout(() => {
                c.faultClearTimer = null;
                this.clearFault(connectorId).catch((e) => this.emit('error', e));
            }, clearAfterSeconds * 1000);
        }
    }

    /** Clear a fault and return the connector to its natural idle state. */
    async clearFault(connectorId: number): Promise<void> {
        const c = this.requireConnector(connectorId);
        if (c.faultClearTimer) {
            clearTimeout(c.faultClearTimer);
            c.faultClearTimer = null;
        }
        if (c.status !== 'Faulted') return;
        const next = c.pluggedIn ? 'Preparing' : 'Available';
        await this.setStatus(connectorId, next);
    }

    /**
     * E-stop: hit the big red button. Aborts every running session
     * with reason=EmergencyStop, flips every connector to Faulted.
     * OCPP doesn't have a dedicated EmergencyStop error code, so the
     * connector-side StatusNotification uses OtherError; the CSMS
     * recognizes the situation by the StopTransaction reason.
     */
    async emergencyStop(): Promise<void> {
        for (const id of this.connectors.keys()) {
            await this.injectFault({
                connectorId: id,
                errorCode: 'OtherError',
                stopReason: 'EmergencyStop',
            });
        }
    }

    /**
     * Stop every active session on this device cleanly (reason=Local).
     * Connectors return to Available; no fault. Used by the fleet-wide
     * "Stop all" path which doesn't want to fault every charger just to
     * end ongoing sessions.
     */
    async stopAllSessions(): Promise<number> {
        let stopped = 0;
        for (const [id, c] of this.connectors.entries()) {
            if (c.transactionId !== null) {
                await this.stopSession(id, 'Local').catch((e) => this.emit('error', e));
                stopped++;
            }
        }
        return stopped;
    }

    /**
     * User-triggered reboot. Same surface as the CSMS Reset CALL: Soft
     * reconnects the WS; Hard also aborts active sessions first.
     */
    async reboot(type: 'Soft' | 'Hard'): Promise<void> {
        if (type === 'Hard') {
            for (const [id, c] of this.connectors.entries()) {
                if (c.transactionId !== null) {
                    await this.stopSession(id, 'HardReset').catch(() => undefined);
                }
            }
        }
        this.client.disconnect();
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
        // §9.1.5 ConnectionTimeOut: arm when entering Preparing, drop
        // on every other transition. setStatus is the single chokepoint
        // for connector-status changes, so this is the right place to
        // wire it. Bool config keys / configs may also override the
        // window — re-read on each arm.
        this.armOrClearConnectionTimeout(connectorId, status);
        this.emit('state', { connectorId, status });
        if (this.client.isOnline()) {
            try {
                await this.client.sendStatusNotification(connectorId, status);
            } catch (err) {
                this.emit('error', err);
            }
        }
    }

    private armOrClearConnectionTimeout(connectorId: number, status: ConnectorStatus): void {
        const c = this.requireConnector(connectorId);
        // Always drop the previous timer first — re-entering Preparing
        // (e.g. plug-out → plug-in cycle) starts a fresh window, and
        // any non-Preparing status cancels.
        if (c.connectionTimeoutTimer) {
            clearTimeout(c.connectionTimeoutTimer);
            c.connectionTimeoutTimer = null;
        }
        if (status !== 'Preparing') return;
        // Read the latest config every arm — change-from-CSMS during a
        // Preparing window is rare but spec-allowed; the *next* Preparing
        // gets the new value, this one keeps the value it was armed with.
        const seconds = this.config.getNumber('ConnectionTimeOut');
        if (!seconds || seconds <= 0) return; // 0 disables the watchdog
        c.connectionTimeoutTimer = setTimeout(() => {
            c.connectionTimeoutTimer = null;
            void this.handleConnectionTimeout(connectorId);
        }, seconds * 1000);
    }

    /** Fires when ConnectionTimeOut elapses while still in Preparing.
     *  Reverts the connector to Available — matching the OCPP §9.1.5
     *  semantics ("the connector returns to Available if the user does
     *  not plug in within the configured time"). */
    private async handleConnectionTimeout(connectorId: number): Promise<void> {
        if (this.stopped) return;
        const c = this.connectors.get(connectorId);
        if (!c || c.status !== 'Preparing') return;
        // pluggedIn is the operator's intent; leave it alone — if a
        // plug arrives later we'll re-enter Preparing via plugIn().
        // For symmetry with plugOut(), clear it so the operator's
        // mental model matches "the cable went away".
        c.pluggedIn = false;
        await this.setStatus(connectorId, 'Available');
    }

    private requireConnector(id: number): ConnectorState {
        const c = this.connectors.get(id);
        if (!c) throw new Error(`device ${this.device.id} has no connector ${id}`);
        return c;
    }

    /**
     * OCPP §5.5 ConcurrentTx detection: a CP must refuse a second
     * concurrent transaction for the same idTag. Returns true when the
     * idTag is already on an active session on this device. Excluding
     * a connector lets startSession run this check before attaching
     * the new session — though we run it before any state change so
     * the exclusion isn't strictly needed today.
     */
    private isIdTagAlreadyActive(idTag: string, exceptConnectorId?: number): boolean {
        if (!idTag) return false;
        for (const [id, c] of this.connectors) {
            if (exceptConnectorId !== undefined && id === exceptConnectorId) continue;
            if (c.idTag === idTag && c.transactionId !== null) return true;
        }
        return false;
    }

    // ---- CSMS-initiated CALL handling ----

    /**
     * Decide how to respond to a CSMS CALL. The OcppClient turns our
     * `IncomingCallResult` into a wire frame; we own the semantics.
     * Public for testing — production traffic flows through the
     * `setIncomingHandler` registration in the constructor.
     */
    async handleCsmsCall(action: string, payload: unknown): Promise<IncomingCallResult> {
        const p = (payload ?? {}) as Record<string, unknown>;
        switch (action) {
            case 'GetConfiguration':
                return { ok: true, result: this.config.getMany(p.key as string[] | undefined) };

            case 'ChangeConfiguration': {
                const key = String(p.key ?? '');
                const value = String(p.value ?? '');
                if (!key) return { ok: true, result: { status: 'Rejected' } };
                const status = this.config.set(key, value);
                return { ok: true, result: { status } };
            }

            case 'RemoteStartTransaction':
                return { ok: true, result: { status: await this.handleRemoteStart(p) } };

            case 'RemoteStopTransaction':
                return { ok: true, result: { status: await this.handleRemoteStop(p) } };

            case 'Reset':
                return { ok: true, result: { status: this.handleReset(String(p.type ?? 'Soft')) } };

            case 'ChangeAvailability':
                return { ok: true, result: { status: await this.handleChangeAvailability(p) } };

            case 'UnlockConnector':
                return { ok: true, result: { status: this.handleUnlock(Number(p.connectorId)) } };

            case 'TriggerMessage':
                return { ok: true, result: { status: await this.handleTrigger(p) } };

            case 'DataTransfer': {
                const vendorId = String(p.vendorId ?? '');
                if (vendorId === this.device.vendor) {
                    return { ok: true, result: { status: 'Accepted' } };
                }
                return { ok: true, result: { status: 'UnknownVendorId' } };
            }

            case 'ClearCache':
                // The local-auth list lives in the store; clearing it
                // here means dropping every entry but keeping the
                // version (the CSMS tracks that). Accepted is the
                // OCPP wire-status either way.
                this.store.replaceLocalAuthList(this.device.id, this.store.getLocalListVersion(this.device.id), []);
                return { ok: true, result: { status: 'Accepted' } };

            case 'ReserveNow':
                return { ok: true, result: { status: await this.handleReserveNow(p) } };

            case 'CancelReservation':
                return { ok: true, result: { status: this.handleCancelReservation(p) } };

            case 'SendLocalList':
                return { ok: true, result: { status: this.handleSendLocalList(p) } };

            case 'GetLocalListVersion':
                return {
                    ok: true,
                    result: { listVersion: this.store.getLocalListVersion(this.device.id) },
                };

            case 'UpdateFirmware':
                this.handleUpdateFirmware(p);
                // OCPP §6.19: UpdateFirmware response carries no fields.
                return { ok: true, result: {} };

            case 'GetDiagnostics':
                return { ok: true, result: this.handleGetDiagnostics(p) };

            case 'SetChargingProfile':
                return { ok: true, result: { status: this.handleSetChargingProfile(p) } };

            case 'ClearChargingProfile':
                return { ok: true, result: { status: this.handleClearChargingProfile(p) } };

            case 'GetCompositeSchedule':
                return { ok: true, result: this.handleGetCompositeSchedule(p) };

            default:
                return { ok: false, code: 'NotImplemented', description: `${action} is not implemented` };
        }
    }

    private handleSetChargingProfile(p: Record<string, unknown>): 'Accepted' | 'Rejected' | 'NotSupported' {
        const parsed = SetChargingProfileReqSchema.safeParse(p);
        if (!parsed.success) return 'Rejected';
        const { connectorId, csChargingProfiles: profile } = parsed.data;
        // OCPP §6.31: ChargePointMaxProfile must target connectorId=0
        // (whole device); the others target a specific connector.
        if (profile.chargingProfilePurpose === 'ChargePointMaxProfile' && connectorId !== 0) {
            return 'Rejected';
        }
        if (
            profile.chargingProfilePurpose !== 'ChargePointMaxProfile' &&
            !this.connectors.has(connectorId)
        ) {
            return 'Rejected';
        }
        this.store.setChargingProfile(this.device.id, connectorId, profile);
        return 'Accepted';
    }

    private handleClearChargingProfile(p: Record<string, unknown>): 'Accepted' | 'Unknown' {
        const parsed = ClearChargingProfileReqSchema.safeParse(p);
        if (!parsed.success) return 'Unknown';
        const removed = this.store.clearChargingProfiles(this.device.id, parsed.data);
        return removed > 0 ? 'Accepted' : 'Unknown';
    }

    private handleGetCompositeSchedule(p: Record<string, unknown>): {
        status: 'Accepted' | 'Rejected';
        connectorId?: number;
        scheduleStart?: string;
        chargingSchedule?: ReturnType<typeof composeSchedule>;
    } {
        const parsed = GetCompositeScheduleReqSchema.safeParse(p);
        if (!parsed.success) return { status: 'Rejected' };
        const { connectorId, duration, chargingRateUnit } = parsed.data;
        if (connectorId !== 0 && !this.connectors.has(connectorId)) {
            return { status: 'Rejected' };
        }
        const profiles = this.profilesFor(connectorId).map((p) => p.profile);
        const conn = connectorId !== 0 ? this.connectors.get(connectorId) : undefined;
        const startMs = Date.now();
        const schedule = composeSchedule({
            profiles,
            startMs,
            durationSeconds: duration,
            unit: chargingRateUnit ?? 'W',
            transactionId: conn?.transactionId ?? null,
            sessionStartMs: conn?.startedAtMs,
        });
        return {
            status: 'Accepted',
            connectorId,
            scheduleStart: new Date(startMs).toISOString(),
            chargingSchedule: schedule,
        };
    }

    /**
     * Profiles eligible for `connectorId`. Includes the profiles
     * stored on this connector plus any ChargePointMaxProfile rows
     * (which the CSMS sets on connectorId=0 but apply to every one).
     */
    private profilesFor(connectorId: number): { connectorId: number; profile: ChargingProfile }[] {
        const all = this.store.listChargingProfiles(this.device.id);
        return all.filter(
            (r) =>
                r.connectorId === connectorId ||
                (r.profile.chargingProfilePurpose === 'ChargePointMaxProfile' && r.connectorId === 0),
        );
    }

    /**
     * Active SmartCharging cap for a connector right now, in watts.
     * Returns null when nothing constrains the rate.
     */
    private activeChargingLimitW(connectorId: number): number | null {
        const conn = this.connectors.get(connectorId);
        const profiles = this.profilesFor(connectorId).map((p) => p.profile);
        if (profiles.length === 0) return null;
        const r = resolveActiveLimit({
            profiles,
            now: Date.now(),
            transactionId: conn?.transactionId ?? null,
            sessionStartMs: conn?.startedAtMs,
        });
        return r.limitW;
    }

    private async handleRemoteStart(p: Record<string, unknown>): Promise<'Accepted' | 'Rejected'> {
        const idTag = typeof p.idTag === 'string' ? p.idTag : '';
        const requestedConnectorId = typeof p.connectorId === 'number' ? p.connectorId : null;
        if (!idTag) return 'Rejected';

        // §5.5 ConcurrentTx: refuse before picking a connector. A CSMS
        // that's tracking idTag → tx mapping shouldn't be able to
        // accidentally double-charge the same user.
        if (this.isIdTagAlreadyActive(idTag)) return 'Rejected';

        // Pick a connector: caller's choice if eligible, else the first
        // Available + Operative one. Reservation rule (§6.18): a Reserved
        // connector is *eligible* only for the idTag that holds the
        // reservation; any other tag is rejected. The startSession
        // guard re-checks this on the way through and consumes the
        // reservation when it matches.
        const candidates = requestedConnectorId !== null ? [requestedConnectorId] : [...this.connectors.keys()];
        const target = candidates.find((id) => {
            const c = this.connectors.get(id);
            if (!c || !c.operative || c.transactionId !== null) return false;
            if (c.status === 'Available') return true;
            if (c.status === 'Reserved' && c.reservation?.idTag === idTag) return true;
            return false;
        });
        if (target === undefined) return 'Rejected';

        // Per OCPP §6.18, if AuthorizeRemoteTxRequests is true the device
        // must Authorize first. The simulator now consults the local-auth
        // list before going to the CSMS:
        //   - LocalAuthListEnabled + LocalPreAuthorize + entry in list →
        //     honor the locally-stored status (skip the CSMS round trip)
        //   - anything else falls through to CSMS Authorize
        const requiresAuthorize = this.config.getBool('AuthorizeRemoteTxRequests') ?? false;
        if (requiresAuthorize) {
            const localEnabled = this.config.getBool('LocalAuthListEnabled') ?? true;
            const localPre = this.config.getBool('LocalPreAuthorize') ?? false;
            const local = localEnabled && localPre
                ? this.store.getLocalAuthEntry(this.device.id, idTag)
                : null;
            if (local) {
                // Honor expiryDate if set. An expired entry counts as
                // Expired regardless of the stored status.
                const expired = local.expiryDate ? Date.parse(local.expiryDate) < Date.now() : false;
                const effective = expired ? 'Expired' : local.status;
                if (effective !== 'Accepted') return 'Rejected';
                // Skip the CSMS round trip — the local list is authoritative.
            } else {
                try {
                    const auth = (await this.client.call('Authorize', { idTag })) as {
                        idTagInfo?: { status?: string };
                    };
                    // OCPP §6.18: only `Accepted` permits the start. Other
                    // statuses (Blocked / Expired / Invalid / ConcurrentTx)
                    // mean the gateway refused the tag.
                    if (auth.idTagInfo?.status !== 'Accepted') return 'Rejected';
                } catch {
                    return 'Rejected';
                }
            }
        }

        // Persist the session row and start asynchronously — the CALLRESULT
        // must come back promptly, but starting the transaction itself is
        // an outgoing CALL chain that can take seconds.
        const sessionRowId = this.store.insertSession({
            deviceId: this.device.id,
            connectorId: target,
            transactionId: 0,
            idTag,
            status: 'active',
            startedAt: new Date().toISOString(),
            endedAt: null,
            endReason: null,
            energyWh: 0,
            peakPowerKw: 0,
        });
        void this.startSession(target, idTag, sessionRowId)
            .then((txId) => {
                this.store.db
                    .prepare(`UPDATE sessions SET transaction_id = ? WHERE id = ?`)
                    .run(txId, sessionRowId);
            })
            .catch((err) => {
                this.store.endSession({
                    id: sessionRowId,
                    endedAt: new Date().toISOString(),
                    endReason: 'aborted',
                    energyWh: 0,
                    peakPowerKw: 0,
                });
                this.emit('error', err);
            });

        return 'Accepted';
    }

    private async handleRemoteStop(p: Record<string, unknown>): Promise<'Accepted' | 'Rejected'> {
        const tx = typeof p.transactionId === 'number' ? p.transactionId : null;
        if (tx === null) return 'Rejected';
        for (const [id, c] of this.connectors.entries()) {
            if (c.transactionId === tx) {
                void this.stopSession(id, 'Remote').catch((err) => this.emit('error', err));
                return 'Accepted';
            }
        }
        return 'Rejected';
    }

    private handleReset(type: string): 'Accepted' | 'Rejected' {
        // Soft = clean-disconnect-and-reconnect.
        // Hard = also abort any active transactions with reason=HardReset.
        const isHard = type === 'Hard';
        // Defer the actual work so the CALLRESULT goes out first.
        setTimeout(() => {
            void this.performReset(isHard);
        }, 100);
        return 'Accepted';
    }

    private async performReset(isHard: boolean): Promise<void> {
        if (isHard) {
            for (const [id, c] of this.connectors.entries()) {
                if (c.transactionId !== null) {
                    await this.stopSession(id, 'HardReset').catch(() => undefined);
                }
            }
        }
        // Disconnect + let the auto-reconnect bring it back. The OcppClient
        // already handles this without our help — close the socket directly.
        this.client.disconnect();
    }

    private async handleChangeAvailability(
        p: Record<string, unknown>,
    ): Promise<'Accepted' | 'Rejected' | 'Scheduled'> {
        const id = typeof p.connectorId === 'number' ? p.connectorId : null;
        const type = String(p.type ?? '');
        if (id === null || (type !== 'Operative' && type !== 'Inoperative')) return 'Rejected';

        // connectorId=0 means "all connectors" per OCPP.
        const targets = id === 0 ? [...this.connectors.keys()] : [id];
        const operative = type === 'Operative';

        // If any target has an active transaction, schedule the change
        // for after the session ends (we just defer setting the flag).
        const anyActive = targets.some((t) => this.connectors.get(t)?.transactionId !== null);
        for (const t of targets) {
            const c = this.connectors.get(t);
            if (!c) return 'Rejected';
            if (c.transactionId !== null) continue; // skip — Scheduled
            c.operative = operative;
            await this.setStatus(t, operative ? 'Available' : 'Unavailable');
        }
        return anyActive ? 'Scheduled' : 'Accepted';
    }

    private handleUnlock(connectorId: number): 'Unlocked' | 'UnlockFailed' | 'NotSupported' {
        if (connectorId <= 0) return 'NotSupported';
        const c = this.connectors.get(connectorId);
        if (!c) return 'NotSupported';
        // No physical lock to model — just report success. If a session
        // is active, OCPP suggests stopping it; we leave that to the
        // CSMS to orchestrate via RemoteStop, since UnlockConnector is
        // the rare-recovery path.
        return 'Unlocked';
    }

    /**
     * OCPP §6.20 SendLocalList. Honors LocalAuthListEnabled. Full
     * updates replace; Differential upserts/deletes per entry. Version
     * must be strictly newer than the stored one for Differential —
     * otherwise VersionMismatch and the CSMS should re-sync via Full.
     */
    private handleSendLocalList(p: Record<string, unknown>): UpdateStatus {
        const enabled = this.config.getBool('LocalAuthListEnabled') ?? true;
        if (!enabled) return 'NotSupported';

        const parsed = SendLocalListReqSchema.safeParse(p);
        if (!parsed.success) return 'Failed';
        const req = parsed.data;
        const list = req.localAuthorizationList ?? [];

        const max = this.config.getNumber('LocalAuthListMaxLength') ?? 1000;
        if (list.length > max) return 'Failed';

        const current = this.store.getLocalListVersion(this.device.id);
        if (req.updateType === 'Differential') {
            // §6.20: Differential requires strictly newer version. The
            // CSMS uses VersionMismatch as a re-sync signal.
            if (req.listVersion <= current) return 'VersionMismatch';
            this.store.applyDifferentialLocalAuth(this.device.id, req.listVersion, list);
            return 'Accepted';
        }
        // Full update: replace everything. Version can be anything
        // the CSMS sends — it's setting authority here.
        this.store.replaceLocalAuthList(this.device.id, req.listVersion, list);
        return 'Accepted';
    }

    /**
     * OCPP §6.19 UpdateFirmware. The CSMS request is fire-and-forget
     * — its CALLRESULT carries no fields. The CP's progress shows up
     * as a series of FirmwareStatusNotification CALLs going the other
     * way: Downloading → Downloaded → Installing → Installed.
     *
     * The simulator never actually fetches firmware — the state walk
     * runs on short timers so a CSMS conformance suite can verify the
     * sequence in well under a second. Step durations are deliberately
     * tiny (50ms each) so a benchmark run isn't held up by a stray
     * UpdateFirmware request.
     */
    private handleUpdateFirmware(p: Record<string, unknown>): void {
        const parsed = UpdateFirmwareReqSchema.safeParse(p);
        if (!parsed.success) return; // §6.19: no error path on the response — log and bail
        // Cancel any in-flight walk so a re-trigger replaces it.
        this.clearFirmwareTimers();
        const stages: FirmwareStatus[] = ['Downloading', 'Downloaded', 'Installing', 'Installed'];
        const stepMs = 50;
        for (let i = 0; i < stages.length; i++) {
            this.firmwareTimers.push(
                setTimeout(() => {
                    const status = stages[i];
                    if (!status) return;
                    this.firmwareStatus = status;
                    this.client
                        .call('FirmwareStatusNotification', { status })
                        .catch(() => undefined);
                }, (i + 1) * stepMs),
            );
        }
    }

    private clearFirmwareTimers(): void {
        for (const t of this.firmwareTimers) clearTimeout(t);
        this.firmwareTimers = [];
    }

    /**
     * OCPP §6.7 GetDiagnostics. Returns a synthetic filename in the
     * CALLRESULT and walks the upload state on its own (Uploading →
     * Uploaded), same shape as UpdateFirmware. The synthetic name lets
     * a CSMS verify the response payload without needing to inspect a
     * real upload.
     */
    private handleGetDiagnostics(p: Record<string, unknown>): { fileName: string } {
        const parsed = GetDiagnosticsReqSchema.safeParse(p);
        // Even with bad params we return a filename — the OCPP message
        // has no error status. Validation just gates the state walk.
        const fileName = `diagnostics-${this.device.id}-${Date.now()}.tar.gz`;
        if (!parsed.success) return { fileName };

        this.clearDiagnosticsTimers();
        const stages: DiagnosticsStatus[] = ['Uploading', 'Uploaded'];
        const stepMs = 50;
        for (let i = 0; i < stages.length; i++) {
            this.diagnosticsTimers.push(
                setTimeout(() => {
                    const status = stages[i];
                    if (!status) return;
                    this.diagnosticsStatus = status;
                    this.client
                        .call('DiagnosticsStatusNotification', { status })
                        .catch(() => undefined);
                }, (i + 1) * stepMs),
            );
        }
        return { fileName };
    }

    private clearDiagnosticsTimers(): void {
        for (const t of this.diagnosticsTimers) clearTimeout(t);
        this.diagnosticsTimers = [];
    }

    /**
     * OCPP §6.18 ReserveNow. Picks the first connector that's free and
     * not already reserved when connectorId=0; otherwise targets the
     * specific connector. Stores the reservation, flips status to
     * Reserved, and arms a one-shot expiry timer.
     */
    private async handleReserveNow(p: Record<string, unknown>): Promise<ReserveNowStatus> {
        const parsed = ReserveNowReqSchema.safeParse(p);
        if (!parsed.success) return 'Rejected';
        const req = parsed.data;

        const targets =
            req.connectorId === 0 ? [...this.connectors.keys()] : [req.connectorId];

        // Filter for an eligible target. The OCPP status enum maps the
        // *first* failing reason — so we look for one that's outright
        // OK; if none, the status reflects why none was suitable.
        let pickedId: number | null = null;
        let firstReason: ReserveNowStatus | null = null;
        for (const id of targets) {
            const c = this.connectors.get(id);
            if (!c) continue;
            if (c.status === 'Faulted') {
                if (!firstReason) firstReason = 'Faulted';
                continue;
            }
            if (!c.operative || c.status === 'Unavailable') {
                if (!firstReason) firstReason = 'Unavailable';
                continue;
            }
            if (c.transactionId !== null || c.status === 'Charging' || c.status === 'Preparing' || c.status === 'Finishing') {
                if (!firstReason) firstReason = 'Occupied';
                continue;
            }
            if (c.reservation && c.reservation.reservationId !== req.reservationId) {
                if (!firstReason) firstReason = 'Occupied';
                continue;
            }
            pickedId = id;
            break;
        }

        if (pickedId === null) {
            return firstReason ?? 'Rejected';
        }

        const c = this.requireConnector(pickedId);
        // Drop any previous timer; spec allows re-issuing the same
        // reservationId to extend.
        if (c.reservationExpiryTimer) clearTimeout(c.reservationExpiryTimer);

        const expiryMs = Date.parse(req.expiryDate);
        const reservation: Reservation = {
            reservationId: req.reservationId,
            connectorId: pickedId,
            idTag: req.idTag,
            parentIdTag: req.parentIdTag,
            expiryMs,
        };
        c.reservation = reservation;

        // Arm the expiry. Negative / past dates fire immediately.
        const delay = Math.max(0, expiryMs - Date.now());
        c.reservationExpiryTimer = setTimeout(() => {
            void this.expireReservation(pickedId);
        }, delay);

        await this.setStatus(pickedId, 'Reserved');
        return 'Accepted';
    }

    /**
     * OCPP §6.4 CancelReservation. Returns Accepted when the
     * reservationId was held by some connector and got cleared;
     * Rejected when no connector held it.
     */
    private handleCancelReservation(p: Record<string, unknown>): CancelReservationStatus {
        const parsed = CancelReservationReqSchema.safeParse(p);
        if (!parsed.success) return 'Rejected';
        const id = parsed.data.reservationId;
        for (const [cid, c] of this.connectors) {
            if (c.reservation?.reservationId === id) {
                this.releaseReservation(cid, /*restoreStatus*/ true);
                return 'Accepted';
            }
        }
        return 'Rejected';
    }

    /** Release the reservation slot. When `restoreStatus` is true and
     *  the connector was in Reserved, flip back to Available — this
     *  is the cancel / expiry path. The "consumed by start_session"
     *  path leaves status alone because the session will move it. */
    private releaseReservation(connectorId: number, restoreStatus: boolean): void {
        const c = this.connectors.get(connectorId);
        if (!c) return;
        if (c.reservationExpiryTimer) {
            clearTimeout(c.reservationExpiryTimer);
            c.reservationExpiryTimer = null;
        }
        c.reservation = null;
        if (restoreStatus && c.status === 'Reserved') {
            void this.setStatus(connectorId, 'Available');
        }
    }

    private async expireReservation(connectorId: number): Promise<void> {
        const c = this.connectors.get(connectorId);
        if (!c?.reservation) return;
        c.reservation = null;
        c.reservationExpiryTimer = null;
        if (c.status === 'Reserved') {
            await this.setStatus(connectorId, 'Available');
        }
    }

    private async handleTrigger(p: Record<string, unknown>): Promise<'Accepted' | 'Rejected' | 'NotImplemented'> {
        const requested = String(p.requestedMessage ?? '');
        const connectorId = typeof p.connectorId === 'number' ? p.connectorId : null;
        switch (requested) {
            case 'BootNotification':
                // OCPP §6.34 — re-emit a BootNotification.
                this.client
                    .call('BootNotification', {
                        chargePointVendor: this.device.vendor,
                        chargePointModel: this.device.model,
                        chargePointSerialNumber: this.device.id,
                        firmwareVersion: this.device.firmwareVersion,
                    })
                    .catch(() => undefined);
                return 'Accepted';
            case 'Heartbeat':
                this.client.call('Heartbeat', {}).catch(() => undefined);
                return 'Accepted';
            case 'StatusNotification': {
                const targets = connectorId !== null ? [connectorId] : [...this.connectors.keys()];
                for (const t of targets) {
                    const c = this.connectors.get(t);
                    if (!c) continue;
                    this.client.sendStatusNotification(t, c.status).catch(() => undefined);
                }
                return 'Accepted';
            }
            case 'MeterValues': {
                const targets = connectorId !== null ? [connectorId] : [...this.connectors.keys()];
                for (const t of targets) {
                    const c = this.connectors.get(t);
                    if (!c?.transactionId) continue;
                    this.client
                        .sendMeterValue(t, c.transactionId, c.energyWh, 0)
                        .catch(() => undefined);
                }
                return 'Accepted';
            }
            case 'DiagnosticsStatusNotification':
                this.client
                    .call('DiagnosticsStatusNotification', { status: this.diagnosticsStatus })
                    .catch(() => undefined);
                return 'Accepted';
            case 'FirmwareStatusNotification':
                this.client
                    .call('FirmwareStatusNotification', { status: this.firmwareStatus })
                    .catch(() => undefined);
                return 'Accepted';
            default:
                return 'NotImplemented';
        }
    }

    private tick(connectorId: number): void {
        // Tick may have been queued before clearInterval ran in stop().
        // Bail before reaching into the (possibly closed) Store.
        if (this.stopped) return;
        const c = this.requireConnector(connectorId);
        if (!c.transactionId) return;

        const nowMs = Date.now();
        const t = (nowMs - c.startedAtMs) / 1000;
        const lagSec = t - Math.round(t) > 0 ? t - Math.floor(t) : 0;
        if (Number.isFinite(lagSec)) simTickLagSeconds.set(lagSec);

        let powerW = 0;
        let socPct: number | undefined;
        let measurands: sim.SampledValue[] = [];

        // SmartCharging cap, if any. Applied uniformly across AC and
        // DC paths — a profile that limits to 5 kW caps a 22 kW AC EVSE
        // and a 100 kW DC charger to 5 kW alike.
        const capW = this.activeChargingLimitW(connectorId);

        if (this.device.type === 'DC') {
            const profile = this.device.dcProfile ?? DEFAULT_DC_PROFILE;
            const r = sim.computeDcMeasurands({ profile, elapsedSec: t, energyWh: c.energyWh });
            powerW = capW !== null ? Math.min(r.frame.powerW, capW) : r.frame.powerW;
            socPct = r.frame.socPct;
            // If the cap reduced the power, re-emit measurands at the new
            // value so per-phase / SoC numbers stay consistent.
            measurands = capW !== null && powerW < r.frame.powerW
                ? recomputeDcMeasurands(c.energyWh, powerW, r.frame.voltageV, r.frame.socPct)
                : r.measurands;
            if (r.frame.completed) {
                this.stopSession(connectorId, 'Local').catch((e) => this.emit('error', e));
                return;
            }
        } else {
            const wiring = this.device.acWiring ?? DEFAULT_AC_WIRING;
            const rawPowerW = this.device.maxPowerKw * 1000;
            const totalKw = (capW !== null ? Math.min(rawPowerW, capW) : rawPowerW) / 1000;
            powerW = totalKw * 1000;
            measurands = sim.computeAcMeasurands({
                totalPowerKw: totalKw,
                energyWh: c.energyWh + powerW / 3600,
                phaseMode: this.device.phaseMode,
                wiring,
            });
        }

        // Energy = ∫ P dt; tick is 1 s, so add P (W) × 1/3600 hours = Wh.
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

        // MeterValues cadence comes from the OCPP config key — operators
        // change it via ChangeConfiguration, and the change has to take
        // effect without restarting the device. Default 60s per spec.
        const cadence = this.config.getNumber('MeterValueSampleInterval') ?? 60;
        if (cadence <= 0) return;
        const seconds = Math.floor(t);
        if (seconds === 0 || seconds % cadence !== 0) return;

        const csv = this.config.get('MeterValuesSampledData');
        const filtered = sim.filterMeasurands(measurands, csv);
        if (filtered.length === 0) return;
        this.client
            .sendMeterValueRich(connectorId, c.transactionId, filtered)
            .catch((e) => this.emit('error', e));
    }
}
