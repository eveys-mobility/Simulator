import type {
    ChargingProfile,
    ChargingProfilePurpose,
    ChargingRateUnit,
    GetCompositeScheduleRes,
} from '@ocpp-sim/core';
import type { RecordedFrame } from './types.js';

interface DeviceState {
    deviceId: string;
    frames: RecordedFrame[];
    waiters: { action: string; resolve: (frame: RecordedFrame) => void }[];
    anyFrameWaiters: ((frame: RecordedFrame) => void)[];
    upgradeHeaders: Record<string, string | string[] | undefined>;
}

type CallDevice = (action: string, payload: unknown) => Promise<unknown>;

/**
 * Per-device API surface. Tests get one of these from
 * `csms.device(id)` (or `await csms.waitForDevice(id)`) and use it to:
 *
 *  - send CSMS-initiated CALLs (`setChargingProfile`, `remoteStart`, …)
 *  - inspect frames the device sent
 *  - block until a particular action arrives
 *
 * All CSMS-call helpers return the typed CALLRESULT; CALLERRORs reject
 * the promise with the error code + description.
 */
export class DeviceHandle {
    constructor(
        private readonly state: DeviceState,
        private readonly callDevice: CallDevice,
    ) {}

    get deviceId(): string {
        return this.state.deviceId;
    }

    /** Send any CSMS-initiated CALL with a custom action. Resolves
     *  with the CALLRESULT payload, rejects with `Error("CODE: desc")`
     *  on CALLERROR. Useful for conformance cases that exercise
     *  actions outside the typed helpers below — e.g. asserting
     *  unimplemented features return NotImplemented. */
    rawCall<T = unknown>(action: string, payload: unknown = {}): Promise<T> {
        return this.callDevice(action, payload) as Promise<T>;
    }

    /** HTTP upgrade headers from the WS handshake. Useful for asserting
     *  on Authorization / User-Agent / etc. Lower-cased keys (Node convention). */
    get upgradeHeaders(): Record<string, string | string[] | undefined> {
        return this.state.upgradeHeaders;
    }

    /** Snapshot of every frame seen on this device's socket so far. */
    get frames(): RecordedFrame[] {
        return [...this.state.frames];
    }

    /** Snapshot of just incoming CALLs (i.e. what the device sent), in order. */
    get calls(): RecordedFrame[] {
        return this.state.frames.filter((f) => f.direction === 'in' && f.type === 'CALL');
    }

    /** Frames whose action matches. Useful for assertions. */
    framesFor(action: string): RecordedFrame[] {
        return this.state.frames.filter((f) => f.action === action);
    }

    /**
     * Wait for the next inbound CALL with the given action. If one
     * already exists in the log, returns it immediately.
     */
    waitForAction(action: string, timeoutMs = 5000): Promise<RecordedFrame> {
        const existing = this.state.frames.find(
            (f) => f.direction === 'in' && f.type === 'CALL' && f.action === action,
        );
        if (existing) return Promise.resolve(existing);
        return new Promise<RecordedFrame>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.state.waiters = this.state.waiters.filter(
                    (w) => w.action !== action || w.resolve !== resolveOnce,
                );
                reject(new Error(`waitForAction(${action}): timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            const resolveOnce = (frame: RecordedFrame) => {
                clearTimeout(timer);
                resolve(frame);
            };
            this.state.waiters.push({ action, resolve: resolveOnce });
        });
    }

    /** Convenience: BootNotification is the first thing every device sends. */
    waitForBoot(timeoutMs = 5000): Promise<RecordedFrame> {
        return this.waitForAction('BootNotification', timeoutMs);
    }

    /** Wait until a StatusNotification with the given status arrives for a connector. */
    async waitForStatus(
        status: string,
        connectorId?: number,
        timeoutMs = 5000,
    ): Promise<RecordedFrame> {
        const matches = (f: RecordedFrame): boolean => {
            if (f.direction !== 'in' || f.type !== 'CALL' || f.action !== 'StatusNotification')
                return false;
            const p = (f.payload ?? {}) as Record<string, unknown>;
            if (p.status !== status) return false;
            if (connectorId !== undefined && p.connectorId !== connectorId) return false;
            return true;
        };
        const existing = this.state.frames.find(matches);
        if (existing) return existing;
        return new Promise<RecordedFrame>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.state.anyFrameWaiters = this.state.anyFrameWaiters.filter(
                    (w) => w !== watcher,
                );
                reject(new Error(`waitForStatus(${status}): timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            const watcher = (f: RecordedFrame): void => {
                if (matches(f)) {
                    clearTimeout(timer);
                    this.state.anyFrameWaiters = this.state.anyFrameWaiters.filter(
                        (w) => w !== watcher,
                    );
                    resolve(f);
                }
            };
            this.state.anyFrameWaiters.push(watcher);
        });
    }

    // ---- CSMS-initiated CALLs ----

    remoteStart(args: { connectorId?: number; idTag: string }): Promise<{
        status: 'Accepted' | 'Rejected';
    }> {
        return this.callDevice('RemoteStartTransaction', args) as Promise<{
            status: 'Accepted' | 'Rejected';
        }>;
    }

    remoteStop(transactionId: number): Promise<{ status: 'Accepted' | 'Rejected' }> {
        return this.callDevice('RemoteStopTransaction', { transactionId }) as Promise<{
            status: 'Accepted' | 'Rejected';
        }>;
    }

    reset(type: 'Soft' | 'Hard'): Promise<{ status: 'Accepted' | 'Rejected' }> {
        return this.callDevice('Reset', { type }) as Promise<{ status: 'Accepted' | 'Rejected' }>;
    }

    changeAvailability(
        connectorId: number,
        type: 'Operative' | 'Inoperative',
    ): Promise<{
        status: 'Accepted' | 'Rejected' | 'Scheduled';
    }> {
        return this.callDevice('ChangeAvailability', { connectorId, type }) as Promise<{
            status: 'Accepted' | 'Rejected' | 'Scheduled';
        }>;
    }

    unlockConnector(
        connectorId: number,
    ): Promise<{ status: 'Unlocked' | 'UnlockFailed' | 'NotSupported' }> {
        return this.callDevice('UnlockConnector', { connectorId }) as Promise<{
            status: 'Unlocked' | 'UnlockFailed' | 'NotSupported';
        }>;
    }

    changeConfiguration(key: string, value: string): Promise<{ status: string }> {
        return this.callDevice('ChangeConfiguration', { key, value }) as Promise<{
            status: string;
        }>;
    }

    getConfiguration(keys?: string[]): Promise<{
        configurationKey: { key: string; readonly: boolean; value?: string }[];
        unknownKey: string[];
    }> {
        return this.callDevice('GetConfiguration', keys ? { key: keys } : {}) as Promise<{
            configurationKey: { key: string; readonly: boolean; value?: string }[];
            unknownKey: string[];
        }>;
    }

    triggerMessage(requestedMessage: string, connectorId?: number): Promise<{ status: string }> {
        const payload: Record<string, unknown> = { requestedMessage };
        if (connectorId !== undefined) payload.connectorId = connectorId;
        return this.callDevice('TriggerMessage', payload) as Promise<{ status: string }>;
    }

    dataTransfer(
        vendorId: string,
        messageId?: string,
        data?: string,
    ): Promise<{ status: string; data?: string }> {
        const payload: Record<string, unknown> = { vendorId };
        if (messageId !== undefined) payload.messageId = messageId;
        if (data !== undefined) payload.data = data;
        return this.callDevice('DataTransfer', payload) as Promise<{
            status: string;
            data?: string;
        }>;
    }

    clearCache(): Promise<{ status: string }> {
        return this.callDevice('ClearCache', {}) as Promise<{ status: string }>;
    }

    // ---- SmartCharging ----

    setChargingProfile(
        connectorId: number,
        profile: ChargingProfile,
    ): Promise<{
        status: 'Accepted' | 'Rejected' | 'NotSupported';
    }> {
        return this.callDevice('SetChargingProfile', {
            connectorId,
            csChargingProfiles: profile,
        }) as Promise<{ status: 'Accepted' | 'Rejected' | 'NotSupported' }>;
    }

    clearChargingProfile(
        filter: {
            id?: number;
            connectorId?: number;
            chargingProfilePurpose?: ChargingProfilePurpose;
            stackLevel?: number;
        } = {},
    ): Promise<{ status: 'Accepted' | 'Unknown' }> {
        return this.callDevice('ClearChargingProfile', filter) as Promise<{
            status: 'Accepted' | 'Unknown';
        }>;
    }

    getCompositeSchedule(args: {
        connectorId: number;
        duration: number;
        chargingRateUnit?: ChargingRateUnit;
    }): Promise<GetCompositeScheduleRes> {
        return this.callDevice('GetCompositeSchedule', args) as Promise<GetCompositeScheduleRes>;
    }
}
