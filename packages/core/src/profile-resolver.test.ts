import { describe, expect, it } from 'vitest';
import type { ChargingProfile } from './charging-profile.js';
import { composeSchedule, resolveActiveLimit } from './profile-resolver.js';

const T0 = Date.parse('2026-05-10T12:00:00Z');

const baseSchedule = (limitW: number) => ({
    chargingRateUnit: 'W' as const,
    chargingSchedulePeriod: [{ startPeriod: 0, limit: limitW, numberPhases: 3 }],
});

const cpMaxProfile = (id: number, stack: number, limitW: number): ChargingProfile => ({
    chargingProfileId: id,
    stackLevel: stack,
    chargingProfilePurpose: 'ChargePointMaxProfile',
    chargingProfileKind: 'Absolute',
    chargingSchedule: { startSchedule: new Date(T0).toISOString(), ...baseSchedule(limitW) },
});

const txDefaultProfile = (id: number, stack: number, limitW: number): ChargingProfile => ({
    chargingProfileId: id,
    stackLevel: stack,
    chargingProfilePurpose: 'TxDefaultProfile',
    chargingProfileKind: 'Absolute',
    chargingSchedule: { startSchedule: new Date(T0).toISOString(), ...baseSchedule(limitW) },
});

const txProfile = (id: number, stack: number, limitW: number, txId?: number): ChargingProfile => ({
    chargingProfileId: id,
    transactionId: txId,
    stackLevel: stack,
    chargingProfilePurpose: 'TxProfile',
    chargingProfileKind: 'Relative',
    chargingSchedule: baseSchedule(limitW),
});

describe('resolveActiveLimit — stack within a purpose', () => {
    it('higher stackLevel wins', () => {
        const r = resolveActiveLimit({
            profiles: [cpMaxProfile(1, 0, 22000), cpMaxProfile(2, 5, 11000)],
            now: T0 + 60_000,
        });
        expect(r.limitW).toBe(11000);
        expect(r.profileId).toBe(2);
    });

    it('expired profiles are ignored', () => {
        const expired: ChargingProfile = {
            ...cpMaxProfile(1, 5, 5000),
            validTo: new Date(T0 - 1000).toISOString(),
        };
        const live = cpMaxProfile(2, 0, 22000);
        const r = resolveActiveLimit({ profiles: [expired, live], now: T0 + 60_000 });
        expect(r.profileId).toBe(2);
        expect(r.limitW).toBe(22000);
    });

    it('returns null when no profile matches', () => {
        const r = resolveActiveLimit({ profiles: [], now: T0 });
        expect(r.limitW).toBeNull();
    });
});

describe('resolveActiveLimit — purpose precedence (minimum across)', () => {
    const profiles: ChargingProfile[] = [
        cpMaxProfile(1, 0, 22000), // 22 kW cap on the device
        txDefaultProfile(2, 0, 11000), // 11 kW default for any session
        txProfile(3, 0, 5000, 99), // 5 kW for session 99 specifically
    ];

    it('with active session, takes the minimum across purposes', () => {
        const r = resolveActiveLimit({
            profiles,
            now: T0 + 60_000,
            transactionId: 99,
            sessionStartMs: T0,
        });
        // TxProfile wins by being smallest.
        expect(r.limitW).toBe(5000);
        expect(r.purpose).toBe('TxProfile');
    });

    it('without a session, only ChargePointMaxProfile applies', () => {
        const r = resolveActiveLimit({ profiles, now: T0 + 60_000 });
        expect(r.limitW).toBe(22000);
        expect(r.purpose).toBe('ChargePointMaxProfile');
    });

    it('TxProfile bound to a different transactionId is ignored', () => {
        const r = resolveActiveLimit({
            profiles,
            now: T0 + 60_000,
            transactionId: 7, // not 99
            sessionStartMs: T0,
        });
        // TxProfile excluded → min(22kW, 11kW) = 11 kW
        expect(r.limitW).toBe(11000);
        expect(r.purpose).toBe('TxDefaultProfile');
    });
});

describe('resolveActiveLimit — period walking', () => {
    it('selects the period whose startPeriod ≤ elapsed', () => {
        const p: ChargingProfile = {
            chargingProfileId: 1,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Absolute',
            chargingSchedule: {
                startSchedule: new Date(T0).toISOString(),
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [
                    { startPeriod: 0, limit: 11000 },
                    { startPeriod: 60, limit: 22000 },
                    { startPeriod: 120, limit: 5000 },
                ],
            },
        };
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 30_000 }).limitW).toBe(11000);
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 90_000 }).limitW).toBe(22000);
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 200_000 }).limitW).toBe(5000);
    });

    it('Relative profile uses sessionStartMs as t=0', () => {
        const p = txProfile(1, 0, 7000, 1);
        const sessionStart = T0 + 5 * 60_000;
        const r = resolveActiveLimit({
            profiles: [p],
            now: sessionStart + 30_000,
            transactionId: 1,
            sessionStartMs: sessionStart,
        });
        expect(r.limitW).toBe(7000);
    });

    it('returns null when duration is exhausted', () => {
        const p: ChargingProfile = {
            chargingProfileId: 1,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Absolute',
            chargingSchedule: {
                startSchedule: new Date(T0).toISOString(),
                duration: 60,
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [{ startPeriod: 0, limit: 11000 }],
            },
        };
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 30_000 }).limitW).toBe(11000);
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 90_000 }).limitW).toBeNull();
    });

    it('Recurring Daily wraps once 24h elapses', () => {
        const p: ChargingProfile = {
            chargingProfileId: 1,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Recurring',
            recurrencyKind: 'Daily',
            chargingSchedule: {
                startSchedule: new Date(T0).toISOString(),
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [
                    { startPeriod: 0, limit: 11000 },
                    { startPeriod: 3600, limit: 22000 }, // after 1 h, raise
                ],
            },
        };
        // 25 h later = 1 h into the next cycle → second period of cycle 2.
        const r = resolveActiveLimit({ profiles: [p], now: T0 + 25 * 3600 * 1000 });
        expect(r.limitW).toBe(22000);
    });
});

describe('resolveActiveLimit — Recurring schedule edge cases', () => {
    /** Build a Recurring Daily schedule that starts at T0 with the
     *  given periods (interpreted as offsets from the cycle start). */
    const dailyRecurring = (
        periods: { startPeriod: number; limit: number }[],
    ): ChargingProfile => ({
        chargingProfileId: 1,
        stackLevel: 0,
        chargingProfilePurpose: 'ChargePointMaxProfile',
        chargingProfileKind: 'Recurring',
        recurrencyKind: 'Daily',
        chargingSchedule: {
            startSchedule: new Date(T0).toISOString(),
            chargingRateUnit: 'W',
            chargingSchedulePeriod: periods,
        },
    });

    it('Daily wrap holds the last period across midnight', () => {
        // Schedule: 11kW from t=0, 5kW from t=22h (off-peak floor). At
        // t=23h+30m we're between the 22h step and the next-day cycle
        // start; the resolver must keep returning 5kW until it wraps,
        // not "snap back" to the 0-period.
        const p = dailyRecurring([
            { startPeriod: 0, limit: 11000 },
            { startPeriod: 22 * 3600, limit: 5000 },
        ]);
        const r1 = resolveActiveLimit({ profiles: [p], now: T0 + 23.5 * 3600 * 1000 });
        expect(r1.limitW).toBe(5000);
        // 0.5h after wrap → back to the 0-period.
        const r2 = resolveActiveLimit({ profiles: [p], now: T0 + (24 + 0.5) * 3600 * 1000 });
        expect(r2.limitW).toBe(11000);
    });

    it('Recurring wraps consistently across many cycles', () => {
        // Same profile after 7 full days should resolve identically to
        // the same offset on day 0 — a regression here would show up
        // as drift in long-running benchmarks.
        const p = dailyRecurring([
            { startPeriod: 0, limit: 11000 },
            { startPeriod: 3600, limit: 22000 },
        ]);
        const day0 = resolveActiveLimit({ profiles: [p], now: T0 + 90 * 60 * 1000 }).limitW;
        const day7 = resolveActiveLimit({
            profiles: [p],
            now: T0 + (7 * 24 + 1.5) * 3600 * 1000,
        }).limitW;
        expect(day7).toBe(day0);
        expect(day7).toBe(22000);
    });

    it('Weekly wraps after 7 days, not 1', () => {
        const p: ChargingProfile = {
            chargingProfileId: 1,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Recurring',
            recurrencyKind: 'Weekly',
            chargingSchedule: {
                startSchedule: new Date(T0).toISOString(),
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [
                    { startPeriod: 0, limit: 11000 },
                    // Steps up at the start of day 6 (within a week).
                    { startPeriod: 6 * 86400, limit: 22000 },
                ],
            },
        };
        // Day 1 → still on the first period (would be a wrap on Daily).
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 1 * 86400 * 1000 }).limitW).toBe(
            11000,
        );
        // Day 6 → the second period.
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 6 * 86400 * 1000 }).limitW).toBe(
            22000,
        );
        // Day 8 → wrapped, back to day-1-of-cycle = first period.
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 8 * 86400 * 1000 }).limitW).toBe(
            11000,
        );
    });

    it('returns null before startSchedule (future-dated profile)', () => {
        const p = dailyRecurring([{ startPeriod: 0, limit: 11000 }]);
        // 1 hour BEFORE the schedule's startSchedule.
        const r = resolveActiveLimit({ profiles: [p], now: T0 - 3600 * 1000 });
        expect(r.limitW).toBeNull();
    });

    it('respects validFrom/validTo around a Recurring schedule', () => {
        // Profile recurs daily, but is gated by a 12h validFrom/validTo
        // window. Outside the window the resolver returns null even
        // though the recurring math would otherwise resolve.
        const p: ChargingProfile = {
            ...dailyRecurring([{ startPeriod: 0, limit: 11000 }]),
            validFrom: new Date(T0).toISOString(),
            validTo: new Date(T0 + 12 * 3600 * 1000).toISOString(),
        };
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 6 * 3600 * 1000 }).limitW).toBe(11000);
        // 13h in — past validTo even though we'd be inside cycle 1.
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 13 * 3600 * 1000 }).limitW).toBeNull();
    });

    it('Recurring with duration < cycle length is "off" between cycles', () => {
        // Window: first hour of every day. The other 23h have no period
        // covering elapsed-since-cycle-start, so the resolver returns
        // null — the device falls back to its hardware max.
        const p: ChargingProfile = {
            chargingProfileId: 1,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Recurring',
            recurrencyKind: 'Daily',
            chargingSchedule: {
                startSchedule: new Date(T0).toISOString(),
                duration: 3600, // 1h window per cycle
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [{ startPeriod: 0, limit: 5000 }],
            },
        };
        // Inside the window on day 0.
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 30 * 60 * 1000 }).limitW).toBe(5000);
        // Outside the window on day 0 (2h in).
        expect(resolveActiveLimit({ profiles: [p], now: T0 + 2 * 3600 * 1000 }).limitW).toBeNull();
        // Inside the window on day 3.
        expect(
            resolveActiveLimit({ profiles: [p], now: T0 + (3 * 24 + 0.5) * 3600 * 1000 }).limitW,
        ).toBe(5000);
    });
});

describe('resolveActiveLimit — A → W conversion', () => {
    it('converts a 16 A 3-phase limit to 11040 W (16×3×230)', () => {
        const p: ChargingProfile = {
            chargingProfileId: 1,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Absolute',
            chargingSchedule: {
                startSchedule: new Date(T0).toISOString(),
                chargingRateUnit: 'A',
                chargingSchedulePeriod: [{ startPeriod: 0, limit: 16, numberPhases: 3 }],
            },
        };
        const r = resolveActiveLimit({ profiles: [p], now: T0 + 60_000 });
        expect(r.limitW).toBe(16 * 3 * 230);
    });
});

describe('composeSchedule', () => {
    it('emits transition points for stepped periods', () => {
        const p: ChargingProfile = {
            chargingProfileId: 1,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Absolute',
            chargingSchedule: {
                startSchedule: new Date(T0).toISOString(),
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [
                    { startPeriod: 0, limit: 11000 },
                    { startPeriod: 60, limit: 22000 },
                ],
            },
        };
        const out = composeSchedule({
            profiles: [p],
            startMs: T0,
            durationSeconds: 120,
            unit: 'W',
        });
        // Two transitions: 0 → 11000, 60 → 22000.
        expect(out.chargingSchedulePeriod.length).toBe(2);
        expect(out.chargingSchedulePeriod[0]).toMatchObject({ startPeriod: 0, limit: 11000 });
        expect(out.chargingSchedulePeriod[1]).toMatchObject({ startPeriod: 60, limit: 22000 });
    });

    it('honors the requested unit on output', () => {
        const p: ChargingProfile = {
            chargingProfileId: 1,
            stackLevel: 0,
            chargingProfilePurpose: 'ChargePointMaxProfile',
            chargingProfileKind: 'Absolute',
            chargingSchedule: {
                startSchedule: new Date(T0).toISOString(),
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [{ startPeriod: 0, limit: 11040 }],
            },
        };
        const out = composeSchedule({
            profiles: [p],
            startMs: T0,
            durationSeconds: 30,
            unit: 'A',
        });
        // 11040 W / (3 phases × 230 V) = 16 A
        expect(out.chargingSchedulePeriod[0]?.limit).toBeCloseTo(16, 1);
    });
});
