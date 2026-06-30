import type { ConformanceCase } from '../runner.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * OCPP 1.6 SmartCharging profile cases. Exercises the SetChargingProfile
 * / ClearChargingProfile / GetCompositeSchedule trio plus the actual
 * effect on the simulator's power output (which is the whole reason
 * the feature exists from a CSMS operator's perspective).
 *
 * Stack precedence (§3.13) is covered by the resolver unit tests in
 * @ocpp-sim/core; here we focus on wire-level conformance: the right
 * status comes back, the profile persists, the composite schedule
 * matches what was installed.
 */
export const SMART_CHARGING_CASES: ConformanceCase[] = [
    {
        id: 'smart.set-profile.charge-point-max-on-connector-zero-accepted',
        title: 'SetChargingProfile ChargePointMaxProfile on connectorId=0 → Accepted',
        profile: 'SmartCharging',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.setChargingProfile(0, {
                chargingProfileId: 1,
                stackLevel: 0,
                chargingProfilePurpose: 'ChargePointMaxProfile',
                chargingProfileKind: 'Absolute',
                chargingSchedule: {
                    startSchedule: new Date().toISOString(),
                    chargingRateUnit: 'W',
                    chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }],
                },
            });
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
        },
    },

    {
        id: 'smart.set-profile.charge-point-max-on-connector-1-rejected',
        title: 'SetChargingProfile ChargePointMaxProfile on a non-zero connector → Rejected',
        profile: 'SmartCharging',
        run: async ({ handle }) => {
            // §6.31: ChargePointMaxProfile must target connectorId=0.
            // Pointing it at a specific connector violates the spec.
            await handle.waitForBoot();
            const r = await handle.setChargingProfile(1, {
                chargingProfileId: 1,
                stackLevel: 0,
                chargingProfilePurpose: 'ChargePointMaxProfile',
                chargingProfileKind: 'Absolute',
                chargingSchedule: {
                    startSchedule: new Date().toISOString(),
                    chargingRateUnit: 'W',
                    chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }],
                },
            });
            if (r.status !== 'Rejected') {
                throw new Error(`expected Rejected, got ${r.status}`);
            }
        },
    },

    {
        id: 'smart.set-profile.tx-default-on-connector-1-accepted',
        title: 'SetChargingProfile TxDefaultProfile on connector 1 → Accepted',
        profile: 'SmartCharging',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.setChargingProfile(1, {
                chargingProfileId: 2,
                stackLevel: 0,
                chargingProfilePurpose: 'TxDefaultProfile',
                chargingProfileKind: 'Absolute',
                chargingSchedule: {
                    startSchedule: new Date().toISOString(),
                    chargingRateUnit: 'W',
                    chargingSchedulePeriod: [{ startPeriod: 0, limit: 7000 }],
                },
            });
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
        },
    },

    {
        id: 'smart.clear-profile.by-id-accepted',
        title: 'ClearChargingProfile by id removes a previously-installed profile',
        profile: 'SmartCharging',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.setChargingProfile(0, {
                chargingProfileId: 42,
                stackLevel: 0,
                chargingProfilePurpose: 'ChargePointMaxProfile',
                chargingProfileKind: 'Absolute',
                chargingSchedule: {
                    startSchedule: new Date().toISOString(),
                    chargingRateUnit: 'W',
                    chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }],
                },
            });
            const cleared = await handle.clearChargingProfile({ id: 42 });
            if (cleared.status !== 'Accepted') {
                throw new Error(`expected Accepted on clear, got ${cleared.status}`);
            }
            // Second clear of the same id finds nothing → Unknown.
            const again = await handle.clearChargingProfile({ id: 42 });
            if (again.status !== 'Unknown') {
                throw new Error(`expected Unknown on second clear, got ${again.status}`);
            }
        },
    },

    {
        id: 'smart.clear-profile.unknown-id-returns-unknown',
        title: 'ClearChargingProfile with an unknown id returns Unknown',
        profile: 'SmartCharging',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.clearChargingProfile({ id: 9999 });
            if (r.status !== 'Unknown') {
                throw new Error(`expected Unknown, got ${r.status}`);
            }
        },
    },

    {
        id: 'smart.get-composite-schedule.echoes-installed-limit',
        title: 'GetCompositeSchedule returns the resolved limit from the installed profile',
        profile: 'SmartCharging',
        run: async ({ handle }) => {
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
            if (sched.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${sched.status}`);
            }
            const first = sched.chargingSchedule?.chargingSchedulePeriod[0]?.limit;
            if (first !== 7000) {
                throw new Error(`expected first-period limit=7000, got ${String(first)}`);
            }
        },
    },

    {
        id: 'smart.cap.clamps-power-output',
        title: 'ChargePointMaxProfile cap clamps the live MeterValues power',
        profile: 'SmartCharging',
        timeoutMs: 20_000,
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);

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
            if (setRes.status !== 'Accepted') {
                throw new Error(`SetChargingProfile expected Accepted, got ${setRes.status}`);
            }

            await handle.changeConfiguration('MeterValueSampleInterval', '1');
            await handle.changeConfiguration(
                'MeterValuesSampledData',
                'Energy.Active.Import.Register,Power.Active.Import',
            );

            await handle.remoteStart({ connectorId: 1, idTag: 'CAP' });
            await handle.waitForStatus('Charging', 1);

            // First MeterValues lands ~1s after Charging fires.
            type SampledValue = { measurand?: string; phase?: string; value: string };
            type MvPayload = { meterValue?: { sampledValue?: SampledValue[] }[] };
            let mv: { payload: unknown } | null = null;
            for (let i = 0; i < 30 && !mv; i++) {
                await sleep(200);
                const inbound = handle
                    .framesFor('MeterValues')
                    .filter((f) => f.direction === 'in' && f.type === 'CALL');
                mv = inbound[inbound.length - 1] ?? null;
            }
            if (!mv) throw new Error('no MeterValues frame within 6s of Charging');
            const sv: SampledValue[] =
                (mv.payload as MvPayload).meterValue?.[0]?.sampledValue ?? [];
            const totalPower = sv.find((v) => v.measurand === 'Power.Active.Import' && !v.phase);
            if (!totalPower)
                throw new Error('Power.Active.Import (no phase) missing from MeterValues');
            const w = Number(totalPower.value);
            if (w !== 5000) {
                throw new Error(`expected clamped power=5000W from the 5kW cap, got ${w}W`);
            }
        },
    },
];
