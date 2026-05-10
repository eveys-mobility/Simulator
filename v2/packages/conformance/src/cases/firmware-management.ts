import type { ConformanceCase } from '../runner.js';

/**
 * OCPP 1.6 FirmwareManagement profile.
 *
 * The simulator doesn't model firmware updates or diagnostics
 * uploads. Both `UpdateFirmware` and `GetDiagnostics` fall through
 * to the default arm and return CALLERROR `NotImplemented` — the
 * spec-correct signal (§1.4) for unsupported features.
 *
 * `DiagnosticsStatusNotification` and `FirmwareStatusNotification`
 * are the *device → CSMS* counterparts; they're covered (and
 * asserted as NotImplemented) under the RemoteTrigger profile in
 * `cases/remote-trigger.ts`.
 */
export const FIRMWARE_MANAGEMENT_CASES: ConformanceCase[] = [
    {
        id: 'firmware.update-firmware-not-implemented',
        title: 'UpdateFirmware returns NotImplemented (feature not modelled)',
        profile: 'FirmwareManagement',
        unimplemented: 'FirmwareManagement not built yet — simulator answers NotImplemented per §1.4',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            try {
                await handle.rawCall('UpdateFirmware', {
                    location: 'http://example.com/firmware.bin',
                    retrieveDate: new Date().toISOString(),
                });
                throw new Error('expected NotImplemented CALLERROR, got CALLRESULT');
            } catch (err) {
                const m = err instanceof Error ? err.message : String(err);
                if (!m.startsWith('NotImplemented:')) {
                    throw new Error(`expected "NotImplemented: ..." error, got "${m}"`);
                }
            }
        },
    },

    {
        id: 'firmware.get-diagnostics-not-implemented',
        title: 'GetDiagnostics returns NotImplemented (feature not modelled)',
        profile: 'FirmwareManagement',
        unimplemented: 'FirmwareManagement not built yet — simulator answers NotImplemented per §1.4',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            try {
                await handle.rawCall('GetDiagnostics', {
                    location: 'ftp://example.com/diagnostics',
                });
                throw new Error('expected NotImplemented CALLERROR, got CALLRESULT');
            } catch (err) {
                const m = err instanceof Error ? err.message : String(err);
                if (!m.startsWith('NotImplemented:')) {
                    throw new Error(`expected "NotImplemented: ..." error, got "${m}"`);
                }
            }
        },
    },
];
