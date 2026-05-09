import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computePhaseFrame, parsePhaseMode, PhaseMode } from './PhaseModel';

const close = (actual: number, expected: number, tolerance: number, label: string): void => {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
    );
};

describe('PhaseModel — balanced mode', () => {
    test('22 kW splits into ~7.33 kW per phase summing to 22 kW', () => {
        const frame = computePhaseFrame(22, 'balanced');
        close(frame.l1.power_w, 7333, 50, 'L1 power');
        close(frame.l2.power_w, 7333, 50, 'L2 power');
        close(frame.l3.power_w, 7333, 50, 'L3 power');
        close(frame.total_p_kw, 22, 0.05, 'total power');
    });

    test('current ≈ 31.9 A per phase at 22 kW / 230 V', () => {
        const frame = computePhaseFrame(22, 'balanced');
        // ~31.9 A ± 0.5 A for the voltage jitter the model adds.
        close(frame.l1.current_a, 31.9, 0.5, 'L1 current');
        close(frame.l2.current_a, 31.9, 0.5, 'L2 current');
        close(frame.l3.current_a, 31.9, 0.5, 'L3 current');
    });

    test('voltage stays within ±0.5 V of nominal', () => {
        const frame = computePhaseFrame(22, 'balanced');
        for (const phase of ['l1', 'l2', 'l3'] as const) {
            close(frame[phase].voltage_v, 230, 0.51, `${phase} voltage`);
        }
    });

    test('zero power gives zero current on all phases', () => {
        const frame = computePhaseFrame(0, 'balanced');
        assert.equal(frame.l1.power_w, 0);
        assert.equal(frame.l2.power_w, 0);
        assert.equal(frame.l3.power_w, 0);
        assert.equal(frame.l1.current_a, 0);
    });
});

describe('PhaseModel — imbalanced mode', () => {
    test('default 15% skew gives L1 high, L2 nominal, L3 low', () => {
        const frame = computePhaseFrame(22, 'imbalanced');
        // Per-phase nominal = 22 kW / 3 = ~7.33 kW.
        // L1 = 7.33 × 1.15 = 8.43 kW, L3 = 7.33 × 0.85 = 6.23 kW.
        close(frame.l1.power_w, 8433, 50, 'L1 power (high)');
        close(frame.l2.power_w, 7333, 50, 'L2 power (nominal)');
        close(frame.l3.power_w, 6233, 50, 'L3 power (low)');
    });

    test('skew is symmetric — sum equals input exactly', () => {
        const frame = computePhaseFrame(22, 'imbalanced');
        close(frame.total_p_kw, 22, 0.001, 'total power');
    });

    test('skew is clamped to 30%', () => {
        const frame = computePhaseFrame(22, 'imbalanced', { imbalance_skew: 0.5 });
        // Effective skew = 0.30; L1 = 7.33 × 1.30 = 9.53 kW
        close(frame.l1.power_w, 9533, 50, 'L1 power at clamped skew');
        close(frame.l3.power_w, 5133, 50, 'L3 power at clamped skew');
    });

    test('negative skew is clamped to 0 (falls back to balanced)', () => {
        const frame = computePhaseFrame(22, 'imbalanced', { imbalance_skew: -0.2 });
        close(frame.l1.power_w, 7333, 50, 'L1 = nominal when skew clamped to 0');
        close(frame.l3.power_w, 7333, 50, 'L3 = nominal when skew clamped to 0');
    });
});

describe('PhaseModel — single-phase mode', () => {
    test('all power on L1, zero on L2/L3', () => {
        const frame = computePhaseFrame(7, 'single-phase');
        // 7 kW < 7.36 kW physical cap (32 A × 230 V) → uncapped
        close(frame.l1.power_w, 7000, 1, 'L1 power');
        assert.equal(frame.l2.power_w, 0);
        assert.equal(frame.l3.power_w, 0);
        assert.equal(frame.l2.current_a, 0);
        assert.equal(frame.l3.current_a, 0);
    });

    test('L2/L3 still report a live voltage even with no current', () => {
        const frame = computePhaseFrame(7, 'single-phase');
        close(frame.l2.voltage_v, 230, 0.51, 'L2 voltage');
        close(frame.l3.voltage_v, 230, 0.51, 'L3 voltage');
    });

    test('caps at V × 32 A regardless of requested power', () => {
        const frame = computePhaseFrame(22, 'single-phase');
        // Cap = ~230 V × 32 A = 7360 W (with voltage jitter, 7256–7475 W).
        assert.ok(frame.l1.power_w <= 7475, `L1 power should be capped, got ${frame.l1.power_w}`);
        assert.ok(frame.l1.power_w >= 7256, `L1 power should be near cap, got ${frame.l1.power_w}`);
        assert.ok(frame.total_p_kw < 7.5, 'total should reflect the cap');
    });

    test('current cap is configurable', () => {
        const frame = computePhaseFrame(22, 'single-phase', { single_phase_current_cap_a: 16 });
        // Cap = ~230 V × 16 A = 3680 W
        close(frame.l1.power_w, 3680, 50, 'L1 power at 16 A cap');
    });
});

describe('PhaseModel — input validation', () => {
    test('negative power treated as zero', () => {
        const frame = computePhaseFrame(-5, 'balanced');
        assert.equal(frame.l1.power_w, 0);
        assert.equal(frame.total_p_kw, 0);
    });

    test('parsePhaseMode accepts the three valid modes', () => {
        assert.deepEqual(parsePhaseMode('balanced'), { mode: 'balanced', warned: false });
        assert.deepEqual(parsePhaseMode('imbalanced'), { mode: 'imbalanced', warned: false });
        assert.deepEqual(parsePhaseMode('single-phase'), { mode: 'single-phase', warned: false });
    });

    test('parsePhaseMode falls back to balanced + warns on garbage', () => {
        assert.deepEqual(parsePhaseMode('bogus'), { mode: 'balanced', warned: true });
        assert.deepEqual(parsePhaseMode(undefined), { mode: 'balanced', warned: true });
        assert.deepEqual(parsePhaseMode(null), { mode: 'balanced', warned: true });
        assert.deepEqual(parsePhaseMode(''), { mode: 'balanced', warned: true });
    });
});

describe('PhaseModel — nominal voltage override', () => {
    test('nominal_voltage_v=240 produces voltages around 240 V', () => {
        const frame = computePhaseFrame(22, 'balanced', { nominal_voltage_v: 240 });
        close(frame.l1.voltage_v, 240, 0.51, 'L1 voltage at 240 V nominal');
    });
});
