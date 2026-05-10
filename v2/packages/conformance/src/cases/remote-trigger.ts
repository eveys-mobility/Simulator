import type { ConformanceCase } from '../runner.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * OCPP 1.6 RemoteTrigger profile. Two of the six TriggerMessage
 * variants (Heartbeat, StatusNotification) are already covered by
 * the Core suite — they're the ones a CSMS leans on most. The
 * cases here cover the remaining four:
 *
 *   - MeterValues during a session
 *   - BootNotification re-emit
 *   - DiagnosticsStatusNotification (this simulator returns
 *     NotImplemented — firmware/diagnostics aren't modelled)
 *   - FirmwareStatusNotification (same)
 *
 * NotImplemented is a *valid* OCPP §6.34 response when the CP
 * doesn't support the requested message. The case asserts the
 * status comes back correctly, which is what a CSMS conformance
 * suite cares about.
 */
export const REMOTE_TRIGGER_CASES: ConformanceCase[] = [
    {
        id: 'trigger.meter-values-during-session',
        title: 'TriggerMessage MeterValues during an active session emits a frame',
        profile: 'RemoteTrigger',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);

            // Default cadence is 60s — won't fire on its own during
            // the test window. The trigger should still produce a
            // frame within ~1s after replying Accepted.
            await handle.remoteStart({ connectorId: 1, idTag: 'CONFORM' });
            await handle.waitForStatus('Charging', 1);

            const before = handle
                .framesFor('MeterValues')
                .filter((f) => f.direction === 'in').length;
            const r = await handle.triggerMessage('MeterValues', 1);
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
            const deadline = Date.now() + 1500;
            while (Date.now() < deadline) {
                const after = handle
                    .framesFor('MeterValues')
                    .filter((f) => f.direction === 'in').length;
                if (after > before) return;
                await sleep(50);
            }
            throw new Error('no MeterValues frame after TriggerMessage within 1.5s');
        },
    },

    {
        id: 'trigger.boot-notification-reemit',
        title: 'TriggerMessage BootNotification causes the CP to send a fresh Boot frame',
        profile: 'RemoteTrigger',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            // The simulator already sent its initial Boot — counting
            // before/after the trigger filters that out.
            const before = handle
                .framesFor('BootNotification')
                .filter((f) => f.direction === 'in').length;
            const r = await handle.triggerMessage('BootNotification');
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
            const deadline = Date.now() + 1500;
            while (Date.now() < deadline) {
                const after = handle
                    .framesFor('BootNotification')
                    .filter((f) => f.direction === 'in').length;
                if (after > before) return;
                await sleep(50);
            }
            throw new Error('no follow-up BootNotification within 1.5s');
        },
    },

    {
        id: 'trigger.diagnostics-status-notification-not-implemented',
        title: 'TriggerMessage DiagnosticsStatusNotification → NotImplemented',
        profile: 'RemoteTrigger',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.triggerMessage('DiagnosticsStatusNotification');
            if (r.status !== 'NotImplemented') {
                throw new Error(
                    `expected NotImplemented (FirmwareManagement profile not modelled), got ${r.status}`,
                );
            }
        },
    },

    {
        id: 'trigger.firmware-status-notification-not-implemented',
        title: 'TriggerMessage FirmwareStatusNotification → NotImplemented',
        profile: 'RemoteTrigger',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.triggerMessage('FirmwareStatusNotification');
            if (r.status !== 'NotImplemented') {
                throw new Error(`expected NotImplemented, got ${r.status}`);
            }
        },
    },

    {
        id: 'trigger.unknown-message-not-implemented',
        title: 'TriggerMessage with an unknown message id → NotImplemented',
        profile: 'RemoteTrigger',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.triggerMessage('TotallyMadeUpMessage');
            if (r.status !== 'NotImplemented') {
                throw new Error(`expected NotImplemented, got ${r.status}`);
            }
        },
    },
];
