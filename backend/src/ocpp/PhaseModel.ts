/**
 * Pure helper that turns a total-power figure into a per-phase
 * frame (V, I, P for each of L1/L2/L3) per the requested mode.
 *
 * Stateless on purpose so it can be unit-tested without setup and
 * called once per meter-value tick without overhead. Anything that
 * persists (config, last frame) lives in TransactionManager.
 */

export type PhaseMode = 'balanced' | 'imbalanced' | 'single-phase';

export interface PhaseReading {
    /** Phase-to-neutral voltage in volts. */
    voltage_v: number;
    /** RMS current in amps. */
    current_a: number;
    /** Active power in watts (V × I × cos φ; we model cos φ = 1). */
    power_w: number;
}

export interface PhaseFrame {
    l1: PhaseReading;
    l2: PhaseReading;
    l3: PhaseReading;
    /** Sum of per-phase active power in kilowatts. Same number we
     *  fed in (modulo single-phase mode capping). */
    total_p_kw: number;
}

export interface PhaseModelOptions {
    /** Phase-to-neutral nominal voltage. Real grids sit at 230 V ±
     *  6 % across the EU; we sample uniform jitter so the trace
     *  doesn't look synthetic. */
    nominal_voltage_v?: number;
    /** Skew factor for `imbalanced` mode (0–0.30). 0.15 → L1
     *  carries +15 %, L3 carries -15 %, L2 carries the nominal
     *  third. Models a worn contactor or a 1-phase EV plugged into
     *  a 3-phase outlet. Hard-clamped to [0, 0.30]. */
    imbalance_skew?: number;
    /** Single-phase EVSE current cap in amps. Used to derive the
     *  power ceiling for single-phase mode (V × I = ~7.36 kW at
     *  230 V × 32 A). Defaults to 32 A. */
    single_phase_current_cap_a?: number;
}

const VOLT_JITTER_V = 0.5;

function jitteredVoltage(nominal_v: number): number {
    return nominal_v + (Math.random() - 0.5) * 2 * VOLT_JITTER_V;
}

function clampSkew(raw: number): number {
    if (!Number.isFinite(raw)) return 0;
    if (raw < 0) return 0;
    if (raw > 0.30) return 0.30;
    return raw;
}

/**
 * Compute a per-phase frame for the given total power and mode.
 *
 * Behavior summary:
 *
 * - `balanced`: total split equally; each phase voltage jittered
 *   around nominal; current = phase_w / phase_v.
 * - `imbalanced`: L1 carries `(1 + skew) × P/3`, L3 carries
 *   `(1 - skew) × P/3`, L2 keeps `P/3`. Sum still equals the input
 *   exactly (the skew is symmetric around the mean).
 * - `single-phase`: all power on L1, capped at `V × I_cap` (the
 *   physical limit a Type 2 cable sees in mode-3 single-phase).
 *   L2 & L3 report 0 A, 0 W but a live voltage — voltage exists
 *   on all three phases regardless of EV draw, so reporting
 *   `null` here would mis-model the meter.
 */
export function computePhaseFrame(
    total_power_kw: number,
    mode: PhaseMode,
    options: PhaseModelOptions = {},
): PhaseFrame {
    const nominal_v = options.nominal_voltage_v ?? 230;
    const skew = clampSkew(options.imbalance_skew ?? 0.15);
    const cap_a = options.single_phase_current_cap_a ?? 32;

    const total_w = Math.max(0, total_power_kw) * 1000;

    if (mode === 'single-phase') {
        const v1 = jitteredVoltage(nominal_v);
        const v2 = jitteredVoltage(nominal_v);
        const v3 = jitteredVoltage(nominal_v);
        const phys_cap_w = v1 * cap_a;
        const p1 = Math.min(total_w, phys_cap_w);
        return {
            l1: { voltage_v: v1, current_a: p1 / v1, power_w: p1 },
            l2: { voltage_v: v2, current_a: 0, power_w: 0 },
            l3: { voltage_v: v3, current_a: 0, power_w: 0 },
            total_p_kw: p1 / 1000,
        };
    }

    const v1 = jitteredVoltage(nominal_v);
    const v2 = jitteredVoltage(nominal_v);
    const v3 = jitteredVoltage(nominal_v);

    if (mode === 'imbalanced') {
        const third = total_w / 3;
        const p1 = third * (1 + skew);
        const p2 = third;
        const p3 = third * (1 - skew);
        return {
            l1: { voltage_v: v1, current_a: p1 / v1, power_w: p1 },
            l2: { voltage_v: v2, current_a: p2 / v2, power_w: p2 },
            l3: { voltage_v: v3, current_a: p3 / v3, power_w: p3 },
            total_p_kw: (p1 + p2 + p3) / 1000,
        };
    }

    // balanced (default and unknown modes — caller logs if it cares)
    const p_each = total_w / 3;
    return {
        l1: { voltage_v: v1, current_a: p_each / v1, power_w: p_each },
        l2: { voltage_v: v2, current_a: p_each / v2, power_w: p_each },
        l3: { voltage_v: v3, current_a: p_each / v3, power_w: p_each },
        total_p_kw: (p_each * 3) / 1000,
    };
}

/** Validate + normalise an incoming mode string. Anything unrecognised
 *  falls back to `balanced` — the caller logs the warning. */
export function parsePhaseMode(raw: string | undefined | null): { mode: PhaseMode; warned: boolean } {
    if (raw === 'balanced' || raw === 'imbalanced' || raw === 'single-phase') {
        return { mode: raw, warned: false };
    }
    return { mode: 'balanced', warned: true };
}
