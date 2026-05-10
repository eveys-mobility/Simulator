import { describe, expect, it } from 'vitest';
import { computePhaseFrame } from './ac-phase.js';

describe('computePhaseFrame', () => {
    it('balanced splits power evenly across three phases', () => {
        const f = computePhaseFrame(9, 'balanced');
        expect(f.l1.powerW).toBeCloseTo(3000, 0);
        expect(f.l2.powerW).toBeCloseTo(3000, 0);
        expect(f.l3.powerW).toBeCloseTo(3000, 0);
    });

    it('single-phase puts everything on L1', () => {
        const f = computePhaseFrame(7, 'single-phase');
        expect(f.l1.powerW).toBe(7000);
        expect(f.l2.powerW).toBe(0);
        expect(f.l3.powerW).toBe(0);
    });

    it('imbalanced sums to total', () => {
        const f = computePhaseFrame(10, 'imbalanced');
        const sum = f.l1.powerW + f.l2.powerW + f.l3.powerW;
        expect(sum).toBeCloseTo(10000, 0);
    });

    it('clamps negative power to zero', () => {
        const f = computePhaseFrame(-5, 'balanced');
        expect(f.totalKw).toBe(0);
        expect(f.l1.powerW).toBe(0);
    });

    it('current = power / voltage (P=VI)', () => {
        const f = computePhaseFrame(6.9, 'balanced'); // 2300W per phase, 230V
        expect(f.l1.currentA).toBeCloseTo(10, 1);
    });
});
