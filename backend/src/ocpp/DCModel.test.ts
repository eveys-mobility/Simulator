import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeDCFrame, DCBatteryProfile } from './DCModel';

const PROFILE_BASE: DCBatteryProfile = {
    capacity_kwh: 60,         // typical mid-size EV pack
    charger_max_kw: 100,      // 100 kW DC charger
    nominal_voltage_v: 400,
    initial_soc_pct: 20,
    target_soc_pct: 80,
    ramp_up_seconds: 25,
};

const close = (actual: number, expected: number, tolerance: number, label: string): void => {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
    );
};

describe('DCModel — ramp-up phase', () => {
    test('zero power right at session start', () => {
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 20,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 0,
            elapsed_seconds_since_last_tick: 1,
        });
        assert.equal(frame.power_w, 0);
        assert.equal(frame.current_a, 0);
    });

    test('ramps to half power at half-ramp time', () => {
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 20,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 12.5,
            elapsed_seconds_since_last_tick: 1,
        });
        // Half of 100 kW × 100% taper fraction (SoC=20 is in CC band) = 50 kW
        close(frame.power_w, 50000, 100, 'mid-ramp power');
    });

    test('reaches full charger rating after ramp_up_seconds', () => {
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 30,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 30,
            elapsed_seconds_since_last_tick: 1,
        });
        close(frame.power_w, 100000, 100, 'full power post-ramp');
    });
});

describe('DCModel — taper curve', () => {
    test('CC phase (SoC 30%) holds full power', () => {
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 30,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 60,
            elapsed_seconds_since_last_tick: 1,
        });
        close(frame.power_w, 100000, 50, 'CC band');
    });

    test('60% SoC drops to 70% rating', () => {
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 60,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 600,
            elapsed_seconds_since_last_tick: 1,
        });
        close(frame.power_w, 70000, 50, '60% taper');
    });

    test('70% SoC drops to 50% rating', () => {
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 70,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 900,
            elapsed_seconds_since_last_tick: 1,
        });
        close(frame.power_w, 50000, 50, '70% taper');
    });

    test('90% SoC drops to 15% rating', () => {
        const frame = computeDCFrame({
            profile: { ...PROFILE_BASE, target_soc_pct: 100 },
            previous_soc_pct: 90,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 1500,
            elapsed_seconds_since_last_tick: 1,
        });
        close(frame.power_w, 15000, 50, '90% taper');
    });
});

describe('DCModel — voltage tracks SoC', () => {
    test('voltage at 0% SoC is ~90% of nominal', () => {
        const frame = computeDCFrame({
            profile: { ...PROFILE_BASE, initial_soc_pct: 0 },
            previous_soc_pct: 0,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 60,
            elapsed_seconds_since_last_tick: 1,
        });
        close(frame.voltage_v, 360, 1, 'voltage at 0% SoC');
    });

    test('voltage at 100% SoC is ~105% of nominal', () => {
        const frame = computeDCFrame({
            profile: { ...PROFILE_BASE, target_soc_pct: 100 },
            previous_soc_pct: 100,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 60,
            elapsed_seconds_since_last_tick: 1,
        });
        close(frame.voltage_v, 420, 1, 'voltage at 100% SoC');
    });

    test('800V pack (E-GMP / Lucid)', () => {
        const frame = computeDCFrame({
            profile: { ...PROFILE_BASE, nominal_voltage_v: 800 },
            previous_soc_pct: 50,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 60,
            elapsed_seconds_since_last_tick: 1,
        });
        // At 50% SoC, voltage = 800 × (0.90 + 0.075) = 780
        close(frame.voltage_v, 780, 1, '800V pack at 50% SoC');
    });
});

describe('DCModel — SoC advancement', () => {
    test('SoC ticks up as energy flows', () => {
        // 100 kW for 10 s = 277.78 Wh. Capacity 60 kWh → +0.46% SoC.
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 30,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 60,
            elapsed_seconds_since_last_tick: 10,
        });
        close(frame.soc_pct, 30 + 0.46, 0.01, 'SoC advance for 10s @ 100kW');
    });

    test('delivered_wh accumulates', () => {
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 30,
            previous_delivered_wh: 1000,
            elapsed_seconds_since_start: 60,
            elapsed_seconds_since_last_tick: 10,
        });
        // Adds (100kW × 10s)/3600 = 277.78 Wh on top of the 1000 baseline
        close(frame.delivered_wh, 1277.78, 1, 'accumulated energy');
    });
});

describe('DCModel — completion semantics', () => {
    test('hits target at or past target_soc_pct', () => {
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 79.95,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 1800,
            elapsed_seconds_since_last_tick: 5,
        });
        // 5 s at the 70% taper (50 kW) ≈ 69.4 Wh ≈ +0.116% SoC, crosses 80%.
        assert.ok(frame.soc_pct >= 80, `SoC should cross 80%, got ${frame.soc_pct}`);
        assert.equal(frame.completed, true);
    });

    test('past target → power is zero', () => {
        const frame = computeDCFrame({
            profile: PROFILE_BASE,
            previous_soc_pct: 80,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 1800,
            elapsed_seconds_since_last_tick: 5,
        });
        assert.equal(frame.power_w, 0);
        assert.equal(frame.completed, true);
    });
});

describe('DCModel — edge cases', () => {
    test('zero capacity does not divide by zero', () => {
        const frame = computeDCFrame({
            profile: { ...PROFILE_BASE, capacity_kwh: 0 },
            previous_soc_pct: 20,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 60,
            elapsed_seconds_since_last_tick: 1,
        });
        // SoC advance = wh / 0 / capacity = Infinity, clamped to 100.
        assert.ok(Number.isFinite(frame.power_w));
    });

    test('SoC clamps to 100', () => {
        const frame = computeDCFrame({
            profile: { ...PROFILE_BASE, capacity_kwh: 0.001, target_soc_pct: 100 },
            previous_soc_pct: 99,
            previous_delivered_wh: 0,
            elapsed_seconds_since_start: 60,
            elapsed_seconds_since_last_tick: 60,
        });
        assert.equal(frame.soc_pct, 100);
    });
});
