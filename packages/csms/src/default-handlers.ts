import type { DeviceCallHandler } from './types.js';

let txCounter = 1;

/**
 * Default responses for the OCPP 1.6J device-initiated CALLs the
 * simulator emits. Each test can override individual entries via
 * MockCsms.setHandler — these are the friendly path that just keeps
 * the device happy.
 */
export function defaultHandlers(): Record<string, DeviceCallHandler> {
    return {
        BootNotification: () => ({
            status: 'Accepted',
            currentTime: new Date().toISOString(),
            interval: 300,
        }),
        Heartbeat: () => ({ currentTime: new Date().toISOString() }),
        StatusNotification: () => ({}),
        Authorize: () => ({ idTagInfo: { status: 'Accepted' } }),
        StartTransaction: () => ({
            transactionId: txCounter++,
            idTagInfo: { status: 'Accepted' },
        }),
        StopTransaction: () => ({}),
        MeterValues: () => ({}),
        DataTransfer: () => ({ status: 'Accepted' }),
        DiagnosticsStatusNotification: () => ({}),
        FirmwareStatusNotification: () => ({}),
    };
}
