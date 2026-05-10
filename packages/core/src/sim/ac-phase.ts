import type { PhaseMode } from '../domain.js';

/**
 * Per-phase reading at a single instant. Power is in watts (the OCPP
 * MeterValues unit); voltage in V, current in A.
 */
export interface PhaseReading {
    voltageV: number;
    currentA: number;
    powerW: number;
}

export interface PhaseFrame {
    l1: PhaseReading;
    l2: PhaseReading;
    l3: PhaseReading;
    totalKw: number;
}

const NOMINAL_VOLTAGE_V = 230;

/**
 * Split a total-power instant into a per-phase frame. The mode
 * controls how voltage/current are distributed:
 *
 * - balanced     — power is split evenly across L1/L2/L3
 * - imbalanced   — L1 carries 60%, L2 30%, L3 10% (asymmetric load)
 * - single-phase — all power on L1, L2 and L3 idle
 */
export function computePhaseFrame(totalKw: number, mode: PhaseMode): PhaseFrame {
    const totalW = Math.max(0, totalKw) * 1000;
    const splits = SPLITS[mode];
    const phases = splits.map((share) => {
        const powerW = totalW * share;
        const currentA = powerW > 0 ? powerW / NOMINAL_VOLTAGE_V : 0;
        return { voltageV: NOMINAL_VOLTAGE_V, currentA, powerW };
    });
    const [l1, l2, l3] = phases as [PhaseReading, PhaseReading, PhaseReading];
    return { l1, l2, l3, totalKw: Math.max(0, totalKw) };
}

const SPLITS: Record<PhaseMode, [number, number, number]> = {
    balanced: [1 / 3, 1 / 3, 1 / 3],
    imbalanced: [0.6, 0.3, 0.1],
    'single-phase': [1, 0, 0],
};
