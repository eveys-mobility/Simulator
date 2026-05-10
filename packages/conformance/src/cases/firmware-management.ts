import type { ConformanceCase } from '../runner.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * OCPP 1.6 FirmwareManagement profile cases (§6.7 GetDiagnostics,
 * §6.19 UpdateFirmware, plus the §6.6 / §6.10 status notifications
 * the CP emits during the walks).
 *
 * The simulator runs the state machines on short timers (50ms steps)
 * so the conformance suite stays fast; a CSMS observes the same
 * sequence a real CP would emit.
 */
export const FIRMWARE_MANAGEMENT_CASES: ConformanceCase[] = [
    {
        id: 'firmware.update-firmware-accepted',
        title: 'UpdateFirmware accepts the request and emits the status walk',
        profile: 'FirmwareManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            // §6.19 response is empty — just verify it didn't error.
            await handle.rawCall('UpdateFirmware', {
                location: 'http://example.com/firmware.bin',
                retrieveDate: new Date().toISOString(),
            });

            // The simulator walks Downloading → Downloaded → Installing → Installed
            // on 50ms timers. Wait long enough for all four to land.
            await sleep(400);
            const seen = handle
                .framesFor('FirmwareStatusNotification')
                .filter((f) => f.direction === 'in')
                .map((f) => (f.payload as { status?: string }).status ?? '');
            const required = ['Downloading', 'Downloaded', 'Installing', 'Installed'];
            for (const s of required) {
                if (!seen.includes(s)) {
                    throw new Error(
                        `FirmwareStatusNotification missing status=${s}; saw [${seen.join(', ')}]`,
                    );
                }
            }
            // And the final reported status must be Installed (the
            // resting end-state).
            if (seen[seen.length - 1] !== 'Installed') {
                throw new Error(
                    `last FirmwareStatusNotification expected Installed, got ${seen[seen.length - 1]}`,
                );
            }
        },
    },

    {
        id: 'firmware.get-diagnostics-returns-filename',
        title: 'GetDiagnostics returns a fileName and walks Uploading → Uploaded',
        profile: 'FirmwareManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = (await handle.rawCall('GetDiagnostics', {
                location: 'ftp://example.com/diagnostics',
            })) as { fileName?: string };
            if (typeof r.fileName !== 'string' || r.fileName.length === 0) {
                throw new Error(`expected fileName string in response, got ${JSON.stringify(r)}`);
            }
            // The simulator emits a synthetic name keyed on the device
            // id; matching the prefix proves it isn't echoing a stub.
            if (!r.fileName.startsWith('diagnostics-')) {
                throw new Error(`fileName should start with 'diagnostics-', got ${r.fileName}`);
            }

            await sleep(250);
            const seen = handle
                .framesFor('DiagnosticsStatusNotification')
                .filter((f) => f.direction === 'in')
                .map((f) => (f.payload as { status?: string }).status ?? '');
            for (const s of ['Uploading', 'Uploaded']) {
                if (!seen.includes(s)) {
                    throw new Error(
                        `DiagnosticsStatusNotification missing status=${s}; saw [${seen.join(', ')}]`,
                    );
                }
            }
        },
    },

    {
        id: 'firmware.trigger-firmware-status-accepted',
        title: 'TriggerMessage FirmwareStatusNotification → Accepted, frame follows',
        profile: 'FirmwareManagement',
        run: async ({ handle }) => {
            // No prior UpdateFirmware — the resting Idle status should
            // come back on demand.
            await handle.waitForBoot();
            const before = handle
                .framesFor('FirmwareStatusNotification')
                .filter((f) => f.direction === 'in').length;
            const r = await handle.triggerMessage('FirmwareStatusNotification');
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
            const deadline = Date.now() + 1000;
            while (Date.now() < deadline) {
                const after = handle
                    .framesFor('FirmwareStatusNotification')
                    .filter((f) => f.direction === 'in').length;
                if (after > before) return;
                await sleep(50);
            }
            throw new Error('no FirmwareStatusNotification frame within 1s of TriggerMessage');
        },
    },

    {
        id: 'firmware.trigger-diagnostics-status-accepted',
        title: 'TriggerMessage DiagnosticsStatusNotification → Accepted, frame follows',
        profile: 'FirmwareManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const before = handle
                .framesFor('DiagnosticsStatusNotification')
                .filter((f) => f.direction === 'in').length;
            const r = await handle.triggerMessage('DiagnosticsStatusNotification');
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
            const deadline = Date.now() + 1000;
            while (Date.now() < deadline) {
                const after = handle
                    .framesFor('DiagnosticsStatusNotification')
                    .filter((f) => f.direction === 'in').length;
                if (after > before) return;
                await sleep(50);
            }
            throw new Error('no DiagnosticsStatusNotification within 1s of TriggerMessage');
        },
    },
];
