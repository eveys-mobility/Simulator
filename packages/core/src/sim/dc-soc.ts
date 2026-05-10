import type { DCBatteryProfile } from '../domain.js';

export interface DCFrame {
    socPct: number;
    voltageV: number;
    currentA: number;
    powerW: number;
    deliveredWh: number;
    completed: boolean;
}

/**
 * DC charging curve. Real BMSes ramp up from 0 to charger_max over
 * the first few seconds, hold near max while SoC < ~80%, then taper
 * as the battery approaches full to protect the cells.
 *
 * `t` is seconds since the session started.
 */
export function computeDCFrame(profile: DCBatteryProfile, t: number, deliveredWh: number): DCFrame {
    const socPct = computeSoc(profile, deliveredWh);
    const completed = socPct >= profile.targetSocPct;

    if (completed) {
        return {
            socPct: profile.targetSocPct,
            voltageV: profile.nominalVoltageV,
            currentA: 0,
            powerW: 0,
            deliveredWh,
            completed: true,
        };
    }

    const ramp = Math.min(1, t / Math.max(1, profile.rampUpSeconds));
    const taper = computeTaper(socPct);
    const powerKw = profile.chargerMaxKw * ramp * taper;
    const powerW = powerKw * 1000;
    const voltageV = profile.nominalVoltageV;
    const currentA = voltageV > 0 ? powerW / voltageV : 0;

    return {
        socPct,
        voltageV,
        currentA,
        powerW,
        deliveredWh,
        completed: false,
    };
}

function computeSoc(profile: DCBatteryProfile, deliveredWh: number): number {
    const capacityWh = profile.capacityKwh * 1000;
    if (capacityWh <= 0) return profile.initialSocPct;
    const addedPct = (deliveredWh / capacityWh) * 100;
    return Math.min(100, profile.initialSocPct + addedPct);
}

/**
 * Linear taper from 100% power below 80% SoC down to ~10% power at
 * 95% SoC. Real curves are exponential but linear is plenty for a
 * simulator and easier to reason about in tests.
 */
function computeTaper(socPct: number): number {
    if (socPct <= 80) return 1;
    if (socPct >= 95) return 0.1;
    return 1 - ((socPct - 80) / 15) * 0.9;
}
