/**
 * Shared types between MockCsms internals and the public DeviceHandle.
 * Kept separate so the user-facing surface is small.
 */

/** A frame as seen by the CSMS. `direction: 'in'` is from the device,
 *  `'out'` is one we sent. CALL frames have an action; CALLRESULT/
 *  CALLERROR frames inherit the action of the matched CALL when known. */
export interface RecordedFrame {
    direction: 'in' | 'out';
    type: 'CALL' | 'CALLRESULT' | 'CALLERROR';
    id: string;
    action?: string;
    payload: unknown;
    /** ms since epoch. */
    at: number;
}

/**
 * Handler invoked when the device sends a CALL. Return the result
 * payload (becomes a CALLRESULT) or throw to send a CALLERROR.
 *
 * Defaults are installed for every standard 1.6J device-initiated
 * action. Tests override per-action via MockCsms.setHandler.
 */
export type DeviceCallHandler = (
    payload: unknown,
    ctx: { deviceId: string; action: string },
) => unknown | Promise<unknown>;

export interface MockCsmsOptions {
    /** TCP port. 0 picks a free one — `csms.url` reflects the choice. */
    port?: number;
    /** Override the default per-action responder map. */
    handlers?: Partial<Record<string, DeviceCallHandler>>;
}
