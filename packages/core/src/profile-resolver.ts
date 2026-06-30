import type {
    ChargingProfile,
    ChargingProfilePurpose,
    ChargingRateUnit,
    ChargingSchedule,
    ChargingSchedulePeriod,
} from './charging-profile.js';

/**
 * Source of the resolved limit: the profile id and purpose, so the
 * caller can show "limited to 11 kW by TxProfile #5" or know that no
 * profile applied (limit returned as null).
 */
export interface ResolvedLimit {
    /** Cap in watts. Convert from A using the assumed line voltage. */
    limitW: number | null;
    profileId: number | null;
    purpose: ChargingProfilePurpose | null;
    stackLevel: number | null;
}

/**
 * Phase-to-neutral voltage used to convert A→W when a profile uses
 * `chargingRateUnit: 'A'`. OCPP says the limit applies per phase; for
 * simplicity (and matching the simulator's default 3-phase 230V wiring)
 * we treat the watts as `limit * numberPhases * voltage`.
 */
const NOMINAL_VOLTAGE_V = 230;

interface ResolveArgs {
    /** All profiles installed across this connector. The resolver
     *  itself filters by connector at the call site — pass the per-
     *  connector slice here. */
    profiles: ChargingProfile[];
    /** Now, in **ms since epoch**, used to pick the active period. */
    now: number;
    /** Active session id if charging, undefined otherwise. */
    transactionId?: number | null;
    /** Session start (ms) — needed when a profile is `Relative`. */
    sessionStartMs?: number;
}

/**
 * OCPP §3.13 stack resolution:
 *   For an active transaction, evaluate purposes in order
 *   TxProfile → TxDefaultProfile → ChargePointMaxProfile, and take
 *   the *minimum* across them (each acts as an additional cap).
 *   When no transaction is active, only ChargePointMaxProfile applies.
 *
 * Within a purpose, the profile with the highest `stackLevel` whose
 * validity window covers `now` wins.
 *
 * Returns `null` for `limitW` when no profile constrains the rate
 * — caller falls back to the device's hardware max.
 */
export function resolveActiveLimit(args: ResolveArgs): ResolvedLimit {
    const { profiles, now, transactionId, sessionStartMs } = args;

    const inSession = typeof transactionId === 'number' && transactionId > 0;
    const purposes: ChargingProfilePurpose[] = inSession
        ? ['TxProfile', 'TxDefaultProfile', 'ChargePointMaxProfile']
        : ['ChargePointMaxProfile'];

    let winning: ResolvedLimit = { limitW: null, profileId: null, purpose: null, stackLevel: null };

    for (const purpose of purposes) {
        const candidates = profiles
            .filter((p) => p.chargingProfilePurpose === purpose && profileValidNow(p, now))
            // TxProfile must match the active session.
            .filter(
                (p) =>
                    purpose !== 'TxProfile' ||
                    p.transactionId === undefined ||
                    p.transactionId === transactionId,
            )
            .sort((a, b) => b.stackLevel - a.stackLevel);
        const top = candidates[0];
        if (!top) continue;

        const limitW = limitInWattsAt(top, now, sessionStartMs);
        if (limitW === null) continue;

        if (winning.limitW === null || limitW < winning.limitW) {
            winning = {
                limitW,
                profileId: top.chargingProfileId,
                purpose,
                stackLevel: top.stackLevel,
            };
        }
    }
    return winning;
}

function profileValidNow(p: ChargingProfile, now: number): boolean {
    if (p.validFrom && Date.parse(p.validFrom) > now) return false;
    if (p.validTo && Date.parse(p.validTo) < now) return false;
    return true;
}

/**
 * Compute the limit in watts for a single profile at `now`, walking
 * its schedule periods. Returns null when the schedule has no period
 * covering this moment (e.g. duration elapsed without recurring).
 */
function limitInWattsAt(
    profile: ChargingProfile,
    now: number,
    sessionStartMs?: number,
): number | null {
    const sched = profile.chargingSchedule;
    const startMs = scheduleStartMs(profile, now, sessionStartMs);
    if (startMs === null) return null;

    let elapsedSec = (now - startMs) / 1000;
    if (elapsedSec < 0) return null;

    if (profile.chargingProfileKind === 'Recurring') {
        const period = profile.recurrencyKind === 'Weekly' ? 7 * 86400 : 86400;
        elapsedSec = elapsedSec % period;
    }

    if (sched.duration !== undefined && elapsedSec > sched.duration) return null;

    const period = activePeriod(sched.chargingSchedulePeriod, elapsedSec);
    if (!period) return null;

    return periodLimitInWatts(sched.chargingRateUnit, period, sched.minChargingRate);
}

function scheduleStartMs(
    profile: ChargingProfile,
    now: number,
    sessionStartMs?: number,
): number | null {
    if (profile.chargingProfileKind === 'Relative') {
        return sessionStartMs ?? null;
    }
    if (profile.chargingSchedule.startSchedule) {
        return Date.parse(profile.chargingSchedule.startSchedule);
    }
    // Absolute without startSchedule → treat as starting at validFrom or now.
    if (profile.validFrom) return Date.parse(profile.validFrom);
    return now;
}

function activePeriod(
    periods: ChargingSchedulePeriod[],
    elapsedSec: number,
): ChargingSchedulePeriod | null {
    // Periods are sorted by startPeriod — pick the latest one whose
    // start is ≤ elapsed.
    let active: ChargingSchedulePeriod | null = null;
    for (const p of periods) {
        if (p.startPeriod <= elapsedSec) active = p;
        else break;
    }
    return active;
}

function periodLimitInWatts(
    unit: ChargingRateUnit,
    period: ChargingSchedulePeriod,
    minRate?: number,
): number {
    const phases = period.numberPhases ?? 3;
    const limit = minRate !== undefined ? Math.max(period.limit, minRate) : period.limit;
    if (unit === 'W') return limit;
    // unit === 'A' → convert to W using nominal voltage × phases.
    return limit * phases * NOMINAL_VOLTAGE_V;
}

/**
 * Build a flattened composite schedule across the given profiles for
 * `durationSeconds` from `startMs`. Used by `GetCompositeSchedule`.
 *
 * Walks at 1-second resolution but emits only transition points, so
 * the returned period array is compact.
 */
export function composeSchedule(args: {
    profiles: ChargingProfile[];
    startMs: number;
    durationSeconds: number;
    unit: ChargingRateUnit;
    transactionId?: number | null;
    sessionStartMs?: number;
}): ChargingSchedule {
    const { profiles, startMs, durationSeconds, unit, transactionId, sessionStartMs } = args;
    const periods: ChargingSchedulePeriod[] = [];

    let lastLimitW: number | null | undefined = undefined;
    for (let t = 0; t <= durationSeconds; t++) {
        const r = resolveActiveLimit({
            profiles,
            now: startMs + t * 1000,
            transactionId,
            sessionStartMs,
        });
        if (r.limitW !== lastLimitW) {
            // Transition point. Use the requested unit on output.
            const limitOut =
                r.limitW === null
                    ? 0
                    : unit === 'W'
                      ? r.limitW
                      : r.limitW / (3 * NOMINAL_VOLTAGE_V);
            periods.push({ startPeriod: t, limit: limitOut, numberPhases: 3 });
            lastLimitW = r.limitW;
        }
    }

    return {
        duration: durationSeconds,
        startSchedule: new Date(startMs).toISOString(),
        chargingRateUnit: unit,
        chargingSchedulePeriod:
            periods.length > 0 ? periods : [{ startPeriod: 0, limit: 0, numberPhases: 3 }],
    };
}
