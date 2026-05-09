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
        cpMaxProfile(1, 0, 22000),     // 22 kW cap on the device
        txDefaultProfile(2, 0, 11000), // 11 kW default for any session
        txProfile(3, 0, 5000, 99),     // 5 kW for session 99 specifically
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
