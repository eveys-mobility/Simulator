import { DEFAULT_AC_WIRING, type Device } from '@ocpp-sim/core';
import { Simulator, Store } from '@ocpp-sim/server/lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockCsms } from './mock-csms.js';

/**
 * End-to-end tests that drive a real Simulator (the production class
 * the v2 server uses) through the MockCsms harness. If these go green,
 * the harness is doing its job: a test author can spin up a CSMS,
 * hand it to a Simulator, and assert against frame log + CALL results
 * without touching `ws` directly.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Attach a no-op error listener — mirrors what DeviceManager does
 *  in production, so unhandled-rejection traces from teardown-during-
 *  pending-CALL don't escape the test runner. */
const silenceErrors = (s: Simulator) => {
    s.on('error', () => undefined);
    return s;
};

const buildAcDevice = (id: string, ocppUrl: string): Device => ({
    id,
    displayName: 'Test AC',
    type: 'AC',
    model: 'Eveys-22kW-AC',
    vendor: 'Eveys',
    firmwareVersion: '1.0.0',
    maxPowerKw: 22,
    ocppUrl,
    phaseMode: 'balanced',
    acWiring: DEFAULT_AC_WIRING,
    createdAt: new Date().toISOString(),
});

describe('MockCsms', () => {
    let csms: MockCsms;
    let store: Store;
    let sim: Simulator | null;

    beforeEach(async () => {
        csms = new MockCsms();
        await csms.start();
        store = new Store(':memory:');
        sim = null;
    });

    afterEach(async () => {
        sim?.stop();
        // Give the simulator's pending .then() chains (e.g. the
        // StartTransaction tx-id update) a microtask to settle before
        // closing the SQLite handle they may still try to write to.
        await new Promise((r) => setTimeout(r, 50));
        store.close();
        await csms.stop();
    });

    it('records BootNotification when a Simulator connects', async () => {
        const device = buildAcDevice('cp_test_boot', csms.url);
        store.insertDevice(device);
        sim = silenceErrors(new Simulator(device, store));
        await sim.start();

        const handle = await csms.waitForDevice(device.id);
        const boot = await handle.waitForBoot();
        const payload = boot.payload as Record<string, unknown>;
        expect(payload.chargePointVendor).toBe('Eveys');
        expect(payload.chargePointModel).toBe('Eveys-22kW-AC');
    });

    it('default handlers keep StartTransaction → StopTransaction round-tripping', async () => {
        const device = buildAcDevice('cp_test_session', csms.url);
        store.insertDevice(device);
        sim = silenceErrors(new Simulator(device, store));
        await sim.start();

        const handle = await csms.waitForDevice(device.id);
        await handle.waitForBoot();
        await handle.waitForStatus('Available', 1);

        const startSessionResult = handle.remoteStart({ connectorId: 1, idTag: 'TEST' });
        await expect(startSessionResult).resolves.toEqual({ status: 'Accepted' });

        // The Simulator runs RemoteStart asynchronously after replying
        // Accepted; wait for the actual StartTransaction CALL.
        const start = await handle.waitForAction('StartTransaction');
        const startPayload = start.payload as Record<string, unknown>;
        expect(startPayload.connectorId).toBe(1);
        expect(startPayload.idTag).toBe('TEST');
    });

    it('GetConfiguration round-trips the device config', async () => {
        const device = buildAcDevice('cp_test_cfg', csms.url);
        store.insertDevice(device);
        sim = silenceErrors(new Simulator(device, store));
        await sim.start();

        const handle = await csms.waitForDevice(device.id);
        await handle.waitForBoot();

        const r = await handle.getConfiguration(['HeartbeatInterval']);
        expect(r.configurationKey).toHaveLength(1);
        expect(r.configurationKey[0]?.key).toBe('HeartbeatInterval');
    });

    it('SmartCharging cap clamps the simulator power output', async () => {
        const device = buildAcDevice('cp_test_smart', csms.url);
        store.insertDevice(device);
        sim = silenceErrors(new Simulator(device, store));
        await sim.start();

        const handle = await csms.waitForDevice(device.id);
        await handle.waitForBoot();
        await handle.waitForStatus('Available', 1);

        // Cap at 5 kW.
        const setRes = await handle.setChargingProfile(0, {
            chargingProfileId: 1,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Absolute',
            chargingSchedule: {
                startSchedule: new Date().toISOString(),
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [{ startPeriod: 0, limit: 5000 }],
            },
        });
        expect(setRes.status).toBe('Accepted');

        // Push the meter cadence down to 1s so the test doesn't have
        // to wait the default 60s for a MeterValues frame.
        await handle.changeConfiguration('MeterValueSampleInterval', '1');
        await handle.changeConfiguration(
            'MeterValuesSampledData',
            'Energy.Active.Import.Register,Power.Active.Import',
        );

        // Start a session and watch for a MeterValues with the clamped power.
        await handle.remoteStart({ connectorId: 1, idTag: 'CAP' });
        await handle.waitForStatus('Charging', 1);

        // First MeterValues hits ~1s after Charging fires.
        let mv: { payload: unknown } | null = null;
        for (let i = 0; i < 30 && !mv; i++) {
            await sleep(200);
            const inbound = handle
                .framesFor('MeterValues')
                .filter((f) => f.direction === 'in' && f.type === 'CALL');
            mv = inbound[inbound.length - 1] ?? null;
        }
        expect(mv).not.toBeNull();
        const payload = mv!.payload as {
            meterValue: { sampledValue: { measurand: string; phase?: string; value: string }[] }[];
        };
        const sv = payload.meterValue[0]?.sampledValue ?? [];
        const totalPower = sv.find((v) => v.measurand === 'Power.Active.Import' && !v.phase);
        expect(totalPower).toBeTruthy();
        expect(Number(totalPower!.value)).toBe(5000);
    });

    it('GetCompositeSchedule returns the resolved schedule', async () => {
        const device = buildAcDevice('cp_test_sched', csms.url);
        store.insertDevice(device);
        sim = silenceErrors(new Simulator(device, store));
        await sim.start();

        const handle = await csms.waitForDevice(device.id);
        await handle.waitForBoot();

        await handle.setChargingProfile(0, {
            chargingProfileId: 7,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Absolute',
            chargingSchedule: {
                startSchedule: new Date().toISOString(),
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [{ startPeriod: 0, limit: 7000 }],
            },
        });

        const sched = await handle.getCompositeSchedule({
            connectorId: 0,
            duration: 60,
            chargingRateUnit: 'W',
        });
        expect(sched.status).toBe('Accepted');
        expect(sched.chargingSchedule?.chargingSchedulePeriod[0]?.limit).toBe(7000);
    });

    it('overridable handler — Authorize can be flipped to Rejected', async () => {
        const csmsRejecting = new MockCsms({
            handlers: {
                Authorize: () => ({ idTagInfo: { status: 'Invalid' } }),
            },
        });
        await csmsRejecting.start();
        const localStore = new Store(':memory:');
        const device = buildAcDevice('cp_test_reject', csmsRejecting.url);
        localStore.insertDevice(device);
        const localSim = silenceErrors(new Simulator(device, localStore));
        await localSim.start();

        try {
            const handle = await csmsRejecting.waitForDevice(device.id);
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            // Set AuthorizeRemoteTxRequests so RemoteStart triggers an Authorize.
            await handle.changeConfiguration('AuthorizeRemoteTxRequests', 'true');
            const r = await handle.remoteStart({ connectorId: 1, idTag: 'BAD' });
            // RemoteStart sees the rejected Authorize and refuses to start.
            expect(r.status).toBe('Rejected');
        } finally {
            localSim.stop();
            localStore.close();
            await csmsRejecting.stop();
        }
    });

    it('sends Authorization: Basic on the WS upgrade when authPassword is set', async () => {
        const device: Device = {
            ...buildAcDevice('cp_test_auth', csms.url),
            authPassword: 's3cret',
        };
        store.insertDevice(device);
        sim = silenceErrors(new Simulator(device, store));
        await sim.start();

        const handle = await csms.waitForDevice(device.id);
        const auth = handle.upgradeHeaders.authorization;
        expect(typeof auth).toBe('string');
        expect(auth).toMatch(/^Basic /);
        const decoded = Buffer.from((auth as string).replace(/^Basic /, ''), 'base64').toString();
        expect(decoded).toBe('cp_test_auth:s3cret');
    });

    it('omits Authorization when no authPassword is set', async () => {
        const device = buildAcDevice('cp_test_noauth', csms.url);
        store.insertDevice(device);
        sim = silenceErrors(new Simulator(device, store));
        await sim.start();

        const handle = await csms.waitForDevice(device.id);
        expect(handle.upgradeHeaders.authorization).toBeUndefined();
    });

    it('honors BootNotification Rejected — retries on the CSMS interval and stays quiet', async () => {
        let bootCount = 0;
        const csmsRejecting = new MockCsms({
            handlers: {
                BootNotification: () => {
                    bootCount += 1;
                    if (bootCount === 1) {
                        return {
                            status: 'Rejected',
                            currentTime: new Date().toISOString(),
                            interval: 1,
                        };
                    }
                    return {
                        status: 'Accepted',
                        currentTime: new Date().toISOString(),
                        interval: 300,
                    };
                },
            },
        });
        await csmsRejecting.start();
        const localStore = new Store(':memory:');
        const device = buildAcDevice('cp_test_rejected', csmsRejecting.url);
        localStore.insertDevice(device);
        const localSim = silenceErrors(new Simulator(device, localStore));
        await localSim.start();

        try {
            const handle = await csmsRejecting.waitForDevice(device.id);

            // While bootCount === 1, the simulator must not have sent
            // any StatusNotification — only BootNotification is allowed
            // by §4.2 in the Rejected state.
            await sleep(300);
            const earlyStatus = handle
                .framesFor('StatusNotification')
                .filter((f) => f.direction === 'in');
            expect(earlyStatus.length).toBe(0);

            // The retry should fire within ~1s and the second boot
            // returns Accepted; Status frames follow.
            const deadline = Date.now() + 4000;
            while (bootCount < 2 && Date.now() < deadline) {
                await sleep(50);
            }
            expect(bootCount).toBeGreaterThanOrEqual(2);
            await handle.waitForStatus('Available', 1, 3000);
        } finally {
            localSim.stop();
            await sleep(50);
            localStore.close();
            await csmsRejecting.stop();
        }
    });

    it('honors BootNotification Pending — defers heartbeat + status frames', async () => {
        // Override the BootNotification handler to return Pending the
        // first time, Accepted the second. The simulator must not send
        // StatusNotification while bootDeferred is true.
        let bootCount = 0;
        const csmsPending = new MockCsms({
            handlers: {
                BootNotification: () => {
                    bootCount += 1;
                    if (bootCount === 1) {
                        return {
                            status: 'Pending',
                            currentTime: new Date().toISOString(),
                            interval: 1,
                        };
                    }
                    return {
                        status: 'Accepted',
                        currentTime: new Date().toISOString(),
                        interval: 300,
                    };
                },
            },
        });
        await csmsPending.start();
        const localStore = new Store(':memory:');
        const device = buildAcDevice('cp_test_pending', csmsPending.url);
        localStore.insertDevice(device);
        const localSim = silenceErrors(new Simulator(device, localStore));
        await localSim.start();

        try {
            const handle = await csmsPending.waitForDevice(device.id);
            // Wait long enough for the retry (interval=1s) to fire and
            // the second BootNotification to come back Accepted.
            const deadline = Date.now() + 4000;
            while (bootCount < 2 && Date.now() < deadline) {
                await sleep(50);
            }
            expect(bootCount).toBeGreaterThanOrEqual(2);

            // Once Accepted, StatusNotification should follow.
            await handle.waitForStatus('Available', 1, 3000);

            // Sanity: at least 2 BootNotification CALLs landed.
            const boots = handle.framesFor('BootNotification').filter((f) => f.direction === 'in');
            expect(boots.length).toBeGreaterThanOrEqual(2);
        } finally {
            localSim.stop();
            await sleep(50);
            localStore.close();
            await csmsPending.stop();
        }
    });

    it('multiple devices on the same CSMS are independent', async () => {
        const a = buildAcDevice('cp_multi_a', csms.url);
        const b = buildAcDevice('cp_multi_b', csms.url);
        store.insertDevice(a);
        store.insertDevice(b);
        const simA = silenceErrors(new Simulator(a, store));
        const simB = silenceErrors(new Simulator(b, store));
        await simA.start();
        await simB.start();

        try {
            const ha = await csms.waitForDevice(a.id);
            const hb = await csms.waitForDevice(b.id);
            await ha.waitForBoot();
            await hb.waitForBoot();
            expect(csms.devicesList()).toContain(a.id);
            expect(csms.devicesList()).toContain(b.id);
            expect(ha.deviceId).toBe(a.id);
            expect(hb.deviceId).toBe(b.id);
        } finally {
            simA.stop();
            simB.stop();
        }
    });
});
