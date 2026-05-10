import { describe, expect, it } from 'vitest';
import { DEFAULT_DC_PROFILE } from '../domain.js';
import { computeDCFrame } from './dc-soc.js';

describe('computeDCFrame', () => {
    it('ramps up from zero in the first seconds', () => {
        const t0 = computeDCFrame(DEFAULT_DC_PROFILE, 0, 0);
        const t10 = computeDCFrame(DEFAULT_DC_PROFILE, 10, 0);
        expect(t0.powerW).toBe(0);
        expect(t10.powerW).toBeGreaterThan(0);
        expect(t10.powerW).toBeLessThan(DEFAULT_DC_PROFILE.chargerMaxKw * 1000);
    });

    it('runs at full power once ramp-up completes and SoC < 80%', () => {
        const f = computeDCFrame(DEFAULT_DC_PROFILE, 100, 0);
        expect(f.powerW).toBeCloseTo(DEFAULT_DC_PROFILE.chargerMaxKw * 1000, -1);
    });

    it('tapers above 80% SoC (target 100% to expose the curve)', () => {
        // The default profile targets 80% SoC, so above 80% it would
        // short-circuit to "completed" (power=0). Use a profile that
        // targets 100% to actually observe the taper curve.
        const profile = { ...DEFAULT_DC_PROFILE, targetSocPct: 100 };
        const cap = profile.capacityKwh * 1000;
        const wh81 = cap * 0.61; // 20% + 61% = 81%
        const wh90 = cap * 0.7; //  20% + 70% = 90%
        const at81 = computeDCFrame(profile, 100, wh81);
        const at90 = computeDCFrame(profile, 100, wh90);
        expect(at81.powerW).toBeGreaterThan(0);
        expect(at90.powerW).toBeLessThan(at81.powerW);
    });

    it('marks completed when SoC reaches target', () => {
        const cap = DEFAULT_DC_PROFILE.capacityKwh * 1000;
        const enough = cap * 0.7; // 20% + 70% = 90%, well past 80% target
        const f = computeDCFrame(DEFAULT_DC_PROFILE, 1000, enough);
        expect(f.completed).toBe(true);
        expect(f.powerW).toBe(0);
        expect(f.currentA).toBe(0);
    });

    it('SoC starts at the configured initial SoC', () => {
        const f = computeDCFrame(DEFAULT_DC_PROFILE, 0, 0);
        expect(f.socPct).toBe(DEFAULT_DC_PROFILE.initialSocPct);
    });
});
