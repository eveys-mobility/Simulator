/**
 * DC fast-charging model.
 *
 * AC chargers (PhaseModel) split a flat power figure across L1/L2/L3.
 * DC chargers are different in three ways that matter for OCPP 1.6
 * MeterValues:
 *
 * 1. **No phases.** The charger output is a single high-voltage DC bus
 *    feeding the battery. Voltage, Current, Power are all single
 *    rows with no `phase` attribute.
 *
 * 2. **DC voltage rises with SoC.** Battery pack voltage tracks
 *    state-of-charge — a typical 400 V pack sits at ~360 V at 0% and
 *    ~415 V at 100%. The CCS handshake negotiates voltage to match.
 *    Real CSMS dashboards plot this; reporting a flat 400 V looks
 *    wrong.
 *
 * 3. **The power curve has a hard taper.** A 100 kW charger pushes
 *    the rated 100 kW from ~10% to ~60% SoC, then tapers (battery
 *    cell limits CC→CV transition). Typical numbers: 100 kW until
 *    60%, ~70 kW at 70%, ~50 kW at 80%, ~30 kW at 90%, ~10 kW at
 *    95%+. The session ends when SoC reaches the user/EV target
 *    (default 80%, the "fast-charge sweet spot"). No realistic DC
 *    simulator emits a flat power figure for an hour.
 *
 * The model is stateless on power and voltage (pure functions of SoC
 * and config) but advances SoC across calls — the caller passes the
 * elapsed seconds since the last tick.
 */

export interface DCBatteryProfile {
    /** Battery pack capacity in kWh. */
    capacity_kwh: number;
    /** Charger's rated DC output in kW. */
    charger_max_kw: number;
    /** Battery pack nominal voltage at 50% SoC. Real-world common
     *  values: 400 V (most EVs), 800 V (Porsche/Hyundai E-GMP/Lucid).
     *  Defaults to 400. */
    nominal_voltage_v?: number;
    /** Initial state-of-charge when charging starts (0–100). */
    initial_soc_pct: number;
    /** Target SoC at which the session auto-completes. Defaults to
     *  80 — the "fast-charge sweet spot" beyond which power tapers
     *  too aggressively to be worth the time. Set to 100 for a
     *  full-charge simulation. */
    target_soc_pct?: number;
    /** Ramp-up duration in seconds — the cable handshake +
     *  insulation test + EV authorization gate. Real DC chargers
     *  see ~20–30 s before the first kW flows. Defaults to 25. */
    ramp_up_seconds?: number;
}

export interface DCFrame {
    /** Live state-of-charge percentage 0–100. */
    soc_pct: number;
    /** DC bus voltage on the wire. Rises with SoC per the
     *  open-circuit-voltage curve. */
    voltage_v: number;
    /** DC current. Power / voltage. */
    current_a: number;
    /** Active power flowing into the battery (W). Reflects the
     *  ramp-up + max + taper curve; not just the charger's rating. */
    power_w: number;
    /** Energy delivered since the start of the session (Wh).
     *  Caller persists this as the cumulative meter register. */
    delivered_wh: number;
    /** True when SoC reached the target — caller should stop the
     *  transaction. */
    completed: boolean;
}

const DEFAULT_NOMINAL_V = 400;
const DEFAULT_TARGET_SOC = 80;
const DEFAULT_RAMP_S = 25;

/**
 * Voltage-vs-SoC curve. Real Li-ion packs sit between ~3.0 V/cell
 * empty and ~4.2 V/cell full; we approximate with a linear segment
 * 90% → 105% of nominal as SoC moves 0 → 100. Good enough for trace
 * realism without modelling cell chemistry.
 */
function packVoltage(nominal_v: number, soc_pct: number): number {
    const factor = 0.90 + 0.15 * (soc_pct / 100); // 0.90 at 0%, 1.05 at 100%
    return nominal_v * factor;
}

/**
 * Power-vs-SoC taper curve, expressed as a fraction of charger max.
 *
 *   0% – 10%   ramp-in handled separately by the caller (cable
 *              handshake — see ramp_up_seconds)
 *  10% – 60%   100%  (CC phase — flat at charger rating)
 *  60% – 70%    70%
 *  70% – 80%    50%
 *  80% – 90%    30%
 *  90% – 95%    15%
 *  95% – 100%    5%
 *
 * The piecewise curve is intentionally chunky: real BMS firmware
 * does step down at characteristic SoC thresholds rather than
 * smoothly, so this looks more authentic on a CSMS plot than a
 * smoothed exponential would.
 */
function powerFraction(soc_pct: number): number {
    if (soc_pct >= 95) return 0.05;
    if (soc_pct >= 90) return 0.15;
    if (soc_pct >= 80) return 0.30;
    if (soc_pct >= 70) return 0.50;
    if (soc_pct >= 60) return 0.70;
    return 1.00;
}

/**
 * Compute the next DC frame given the elapsed seconds since the
 * previous tick. The caller keeps `previous_soc_pct` and
 * `previous_delivered_wh` between calls; this function is pure
 * (no internal state).
 */
export function computeDCFrame(args: {
    profile: DCBatteryProfile;
    previous_soc_pct: number;
    previous_delivered_wh: number;
    elapsed_seconds_since_start: number;
    elapsed_seconds_since_last_tick: number;
}): DCFrame {
    const {
        profile,
        previous_soc_pct,
        previous_delivered_wh,
        elapsed_seconds_since_start,
        elapsed_seconds_since_last_tick,
    } = args;

    const nominal_v = profile.nominal_voltage_v ?? DEFAULT_NOMINAL_V;
    const target_soc = profile.target_soc_pct ?? DEFAULT_TARGET_SOC;
    const ramp_s = profile.ramp_up_seconds ?? DEFAULT_RAMP_S;

    // Already at or past the target → freeze power; let the caller
    // call stopTransaction and observe `completed = true`.
    if (previous_soc_pct >= target_soc) {
        const v = packVoltage(nominal_v, previous_soc_pct);
        return {
            soc_pct: previous_soc_pct,
            voltage_v: v,
            current_a: 0,
            power_w: 0,
            delivered_wh: previous_delivered_wh,
            completed: true,
        };
    }

    // Ramp-up: linear from 0 to charger_max over ramp_s seconds.
    let target_kw = profile.charger_max_kw;
    if (elapsed_seconds_since_start < ramp_s) {
        target_kw = profile.charger_max_kw * (elapsed_seconds_since_start / ramp_s);
    }

    // Apply the SoC-driven taper.
    const power_w = Math.max(0, target_kw * 1000 * powerFraction(previous_soc_pct));

    // Voltage from the OCV curve at the current SoC.
    const voltage_v = packVoltage(nominal_v, previous_soc_pct);
    const current_a = voltage_v > 0 ? power_w / voltage_v : 0;

    // Energy delivered this tick → SoC advance.
    const delta_wh = (power_w * elapsed_seconds_since_last_tick) / 3600;
    const delivered_wh = previous_delivered_wh + delta_wh;
    const soc_advance_pct = (delta_wh / 1000 / profile.capacity_kwh) * 100;
    let new_soc_pct = previous_soc_pct + soc_advance_pct;
    if (new_soc_pct > 100) new_soc_pct = 100;

    return {
        soc_pct: new_soc_pct,
        voltage_v,
        current_a,
        power_w,
        delivered_wh,
        completed: new_soc_pct >= target_soc,
    };
}
