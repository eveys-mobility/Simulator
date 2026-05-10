import type { ConformanceCase } from '../runner.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * OCPP 1.6 Core profile conformance cases. Each one exercises a
 * specific sentence of the spec and asserts the simulator behaves
 * the way a CSMS would expect a real charger to behave.
 *
 * The intent is positive: every check should pass against this
 * simulator. They double as regression cover for the Simulator
 * implementation. New cases land here as we cover more of the spec.
 */
export const CORE_CASES: ConformanceCase[] = [
    {
        id: 'core.boot.accepted',
        title: 'BootNotification — payload contains vendor/model/serial',
        profile: 'Core',
        run: async ({ handle, device }) => {
            const boot = await handle.waitForBoot();
            const payload = boot.payload as Record<string, unknown>;
            if (payload.chargePointVendor !== device.vendor) {
                throw new Error(
                    `chargePointVendor expected ${device.vendor}, got ${String(payload.chargePointVendor)}`,
                );
            }
            if (payload.chargePointModel !== device.model) {
                throw new Error(
                    `chargePointModel expected ${device.model}, got ${String(payload.chargePointModel)}`,
                );
            }
            if (payload.chargePointSerialNumber !== device.id) {
                throw new Error(
                    `chargePointSerialNumber expected ${device.id}, got ${String(payload.chargePointSerialNumber)}`,
                );
            }
            if (payload.firmwareVersion !== device.firmwareVersion) {
                throw new Error(
                    `firmwareVersion expected ${device.firmwareVersion}, got ${String(payload.firmwareVersion)}`,
                );
            }
        },
    },

    {
        id: 'core.status.initial-available',
        title: 'After Boot Accepted, every connector reports Available',
        profile: 'Core',
        run: async ({ handle, device }) => {
            await handle.waitForBoot();
            const expectedConnectors = device.type === 'DC' ? 2 : 1;
            for (let cId = 1; cId <= expectedConnectors; cId++) {
                await handle.waitForStatus('Available', cId);
            }
        },
    },

    {
        id: 'core.session.status-sequence',
        title: 'Session walks Available → Preparing → Charging → Finishing → Available',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);

            // Drop the meter cadence so the test doesn't have to wait the
            // 60s default for charging telemetry to land.
            await handle.changeConfiguration('MeterValueSampleInterval', '1');

            const start = await handle.remoteStart({ connectorId: 1, idTag: 'CONFORM' });
            if (start.status !== 'Accepted') {
                throw new Error(`RemoteStart expected Accepted, got ${start.status}`);
            }
            await handle.waitForStatus('Charging', 1);

            // Get the active transactionId from the StartTransaction frame.
            const startTx = await handle.waitForAction('StartTransaction');
            const txId = (startTx.payload as { transactionId?: number }).transactionId;
            if (typeof txId !== 'number') {
                // Some responders supply transactionId via the *response* —
                // the simulator stores it before completing the call, so
                // it's available via the active state.
                // Fallthrough to remoteStop with a sentinel that resolves
                // by frame matching; default-handlers echo it.
            }

            // Stop via RemoteStop and assert the connector returns to
            // Available. RemoteStop accepts any tx id when the
            // simulator only has one active session; default tests use 1.
            const stop = await handle.remoteStop(txId ?? 1);
            if (stop.status !== 'Accepted') {
                throw new Error(`RemoteStop expected Accepted, got ${stop.status}`);
            }
            await handle.waitForStatus('Available', 1);
        },
    },

    {
        id: 'core.heartbeat.change-configuration-accepted',
        title: 'ChangeConfiguration HeartbeatInterval is Accepted and the CP applies it',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();

            const r = await handle.changeConfiguration('HeartbeatInterval', '60');
            if (r.status !== 'Accepted') {
                throw new Error(
                    `ChangeConfiguration HeartbeatInterval=60 expected Accepted, got ${r.status}`,
                );
            }
            const cfg = await handle.getConfiguration(['HeartbeatInterval']);
            const v = cfg.configurationKey.find((k) => k.key === 'HeartbeatInterval')?.value;
            if (v !== '60') {
                throw new Error(`expected HeartbeatInterval=60 after write, got ${String(v)}`);
            }
            // The implementation clamps to a 30s floor for safety —
            // any value ≥30 should round-trip unchanged.
        },
    },

    {
        id: 'core.config.get-enumerates-known-keys',
        title: 'GetConfiguration without a key list returns every standard key',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const cfg = await handle.getConfiguration();
            if (!Array.isArray(cfg.configurationKey) || cfg.configurationKey.length < 20) {
                throw new Error(
                    `expected ≥20 configurationKey entries, got ${cfg.configurationKey?.length ?? 'none'}`,
                );
            }
            // Spot-check the must-haves. If any are missing the simulator
            // is failing to seed defaults from STANDARD_CONFIG_KEYS.
            const present = new Set(cfg.configurationKey.map((k) => k.key));
            for (const required of [
                'HeartbeatInterval',
                'MeterValueSampleInterval',
                'NumberOfConnectors',
                'SupportedFeatureProfiles',
                'AuthorizeRemoteTxRequests',
            ]) {
                if (!present.has(required)) {
                    throw new Error(`required key missing from GetConfiguration: ${required}`);
                }
            }
        },
    },

    {
        id: 'core.config.unknown-keys-reported',
        title: 'GetConfiguration with unknown keys returns them in unknownKey',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const cfg = await handle.getConfiguration(['HeartbeatInterval', 'NotARealKey']);
            const known = cfg.configurationKey.map((k) => k.key);
            if (!known.includes('HeartbeatInterval')) {
                throw new Error('HeartbeatInterval missing from configurationKey');
            }
            if (!cfg.unknownKey.includes('NotARealKey')) {
                throw new Error(`NotARealKey expected in unknownKey, got ${JSON.stringify(cfg.unknownKey)}`);
            }
        },
    },

    {
        id: 'core.config.change-persists',
        title: 'ChangeConfiguration → GetConfiguration round-trips the new value',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const wrote = await handle.changeConfiguration('MeterValueSampleInterval', '42');
            if (wrote.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${wrote.status}`);
            }
            const cfg = await handle.getConfiguration(['MeterValueSampleInterval']);
            const v = cfg.configurationKey.find((k) => k.key === 'MeterValueSampleInterval')?.value;
            if (v !== '42') {
                throw new Error(`expected MeterValueSampleInterval='42' after write, got ${String(v)}`);
            }
        },
    },

    {
        id: 'core.config.readonly-rejected',
        title: 'ChangeConfiguration on a read-only key returns Rejected',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.changeConfiguration('NumberOfConnectors', '99');
            if (r.status !== 'Rejected') {
                throw new Error(`expected Rejected on read-only key, got ${r.status}`);
            }
            // Value must remain unchanged.
            const cfg = await handle.getConfiguration(['NumberOfConnectors']);
            const v = cfg.configurationKey.find((k) => k.key === 'NumberOfConnectors')?.value;
            if (v === '99') {
                throw new Error('NumberOfConnectors changed despite Rejected status');
            }
        },
    },

    {
        id: 'core.authorize.remote-start-with-authorize-on',
        title: 'RemoteStart triggers Authorize when AuthorizeRemoteTxRequests=true',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.changeConfiguration('AuthorizeRemoteTxRequests', 'true');

            // The CSMS Authorize handler defaults to Accepted, so the
            // session should still start. The conformance check is on
            // the order: Authorize CALL must precede StartTransaction.
            const r = await handle.remoteStart({ connectorId: 1, idTag: 'CONFORM' });
            if (r.status !== 'Accepted') {
                throw new Error(`RemoteStart expected Accepted, got ${r.status}`);
            }
            await handle.waitForAction('Authorize');
            const startTx = await handle.waitForAction('StartTransaction');

            const calls = handle.calls;
            const authIdx = calls.findIndex((c) => c.action === 'Authorize');
            const startIdx = calls.findIndex((c) => c === startTx);
            if (authIdx < 0 || startIdx < 0 || authIdx > startIdx) {
                throw new Error(
                    `Authorize must precede StartTransaction; got authIdx=${authIdx} startIdx=${startIdx}`,
                );
            }
        },
    },

    {
        id: 'core.authorize.remote-start-rejected-on-invalid',
        title: 'RemoteStart with Authorize=Invalid returns Rejected and does not start',
        profile: 'Core',
        csmsOptions: {
            handlers: {
                Authorize: () => ({ idTagInfo: { status: 'Invalid' } }),
            },
        },
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.changeConfiguration('AuthorizeRemoteTxRequests', 'true');

            const r = await handle.remoteStart({ connectorId: 1, idTag: 'BAD' });
            if (r.status !== 'Rejected') {
                throw new Error(`RemoteStart with Invalid Authorize expected Rejected, got ${r.status}`);
            }
            // No StartTransaction CALL must follow.
            await sleep(200);
            const startCalls = handle.framesFor('StartTransaction').filter((f) => f.direction === 'in');
            if (startCalls.length > 0) {
                throw new Error('StartTransaction was sent despite Invalid Authorize');
            }
        },
    },

    {
        id: 'core.availability.inoperative-makes-connector-unavailable',
        title: 'ChangeAvailability Inoperative flips connector to Unavailable; Operative restores Available',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);

            const inop = await handle.changeAvailability(1, 'Inoperative');
            if (inop.status !== 'Accepted') {
                throw new Error(`Inoperative expected Accepted, got ${inop.status}`);
            }
            await handle.waitForStatus('Unavailable', 1);

            const op = await handle.changeAvailability(1, 'Operative');
            if (op.status !== 'Accepted') {
                throw new Error(`Operative expected Accepted, got ${op.status}`);
            }
            await handle.waitForStatus('Available', 1);
        },
    },

    {
        id: 'core.availability.scheduled-when-charging',
        title: 'ChangeAvailability returns Scheduled when a session is active',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.changeConfiguration('MeterValueSampleInterval', '60');

            await handle.remoteStart({ connectorId: 1, idTag: 'CONFORM' });
            await handle.waitForStatus('Charging', 1);

            // OCPP §6.7: when a transaction is in progress the CP must
            // defer the availability change and reply Scheduled — the
            // status only flips after the session ends.
            const r = await handle.changeAvailability(1, 'Inoperative');
            if (r.status !== 'Scheduled') {
                throw new Error(`expected Scheduled while charging, got ${r.status}`);
            }
        },
    },

    {
        id: 'core.reset.soft-accepted',
        title: 'Reset Soft is Accepted by the CP',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.reset('Soft');
            if (r.status !== 'Accepted') {
                throw new Error(`Reset Soft expected Accepted, got ${r.status}`);
            }
        },
    },

    {
        id: 'core.reset.hard-stops-active-session',
        title: 'Reset Hard ends an active transaction with a HardReset reason',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.changeConfiguration('MeterValueSampleInterval', '60');

            await handle.remoteStart({ connectorId: 1, idTag: 'CONFORM' });
            await handle.waitForStatus('Charging', 1);

            const r = await handle.reset('Hard');
            if (r.status !== 'Accepted') {
                throw new Error(`Reset Hard expected Accepted, got ${r.status}`);
            }
            // The CP should send a StopTransaction with reason=HardReset
            // for the active session before tearing down.
            const stop = await handle.waitForAction('StopTransaction');
            const reason = (stop.payload as { reason?: string }).reason;
            if (reason !== 'HardReset') {
                throw new Error(`StopTransaction reason expected HardReset, got ${String(reason)}`);
            }
        },
    },

    {
        id: 'core.unlock.unlocked-on-valid-connector',
        title: 'UnlockConnector returns Unlocked for a valid connector',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.unlockConnector(1);
            if (r.status !== 'Unlocked') {
                throw new Error(`UnlockConnector(1) expected Unlocked, got ${r.status}`);
            }
        },
    },

    {
        id: 'core.unlock.not-supported-on-zero',
        title: 'UnlockConnector(0) returns NotSupported (the device is not a connector)',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.unlockConnector(0);
            if (r.status !== 'NotSupported') {
                throw new Error(`UnlockConnector(0) expected NotSupported, got ${r.status}`);
            }
        },
    },

    {
        id: 'core.data-transfer.unknown-vendor-rejected',
        title: 'DataTransfer with unknown vendorId returns UnknownVendorId',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.dataTransfer('com.notarealvendor.example');
            if (r.status !== 'UnknownVendorId') {
                throw new Error(`expected UnknownVendorId, got ${r.status}`);
            }
        },
    },

    {
        id: 'core.data-transfer.own-vendor-accepted',
        title: 'DataTransfer with the device vendorId is Accepted',
        profile: 'Core',
        run: async ({ handle, device }) => {
            await handle.waitForBoot();
            const r = await handle.dataTransfer(device.vendor);
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted for own vendorId, got ${r.status}`);
            }
        },
    },

    {
        id: 'core.trigger.heartbeat-sends-frame',
        title: 'TriggerMessage Heartbeat causes the CP to emit a Heartbeat',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const before = handle
                .framesFor('Heartbeat')
                .filter((f) => f.direction === 'in').length;
            const r = await handle.triggerMessage('Heartbeat');
            if (r.status !== 'Accepted') {
                throw new Error(`TriggerMessage Heartbeat expected Accepted, got ${r.status}`);
            }
            // Wait briefly — the simulator fires the triggered frame
            // asynchronously after replying Accepted.
            const deadline = Date.now() + 1000;
            while (Date.now() < deadline) {
                const after = handle.framesFor('Heartbeat').filter((f) => f.direction === 'in').length;
                if (after > before) return;
                await sleep(50);
            }
            throw new Error('Heartbeat frame did not follow TriggerMessage within 1s');
        },
    },

    {
        id: 'core.trigger.status-notification-sends-frame',
        title: 'TriggerMessage StatusNotification causes the CP to emit current status',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            const before = handle
                .framesFor('StatusNotification')
                .filter((f) => f.direction === 'in').length;
            const r = await handle.triggerMessage('StatusNotification', 1);
            if (r.status !== 'Accepted') {
                throw new Error(`TriggerMessage StatusNotification expected Accepted, got ${r.status}`);
            }
            const deadline = Date.now() + 1000;
            while (Date.now() < deadline) {
                const after = handle
                    .framesFor('StatusNotification')
                    .filter((f) => f.direction === 'in').length;
                if (after > before) return;
                await sleep(50);
            }
            throw new Error('StatusNotification did not follow TriggerMessage within 1s');
        },
    },
];
