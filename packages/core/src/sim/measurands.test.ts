import { describe, expect, it } from 'vitest';
import { DEFAULT_AC_WIRING, DEFAULT_DC_PROFILE } from '../domain.js';
import { computeAcMeasurands, computeDcMeasurands, filterMeasurands } from './measurands.js';

describe('computeAcMeasurands — 3-phase balanced', () => {
    const measurands = computeAcMeasurands({
        totalPowerKw: 9,
        energyWh: 1234,
        phaseMode: 'balanced',
        wiring: DEFAULT_AC_WIRING,
    });

    it('emits the three totals (Energy, Power, Frequency)', () => {
        expect(measurands.find((m) => m.measurand === 'Energy.Active.Import.Register' && !m.phase)?.value).toBe(
            '1234',
        );
        expect(measurands.find((m) => m.measurand === 'Power.Active.Import' && !m.phase)?.value).toBe('9000');
        expect(measurands.find((m) => m.measurand === 'Frequency' && !m.phase)?.value).toBe('50.0');
    });

    it('emits Voltage L1/L2/L3 with the configured nominal', () => {
        const voltages = measurands.filter((m) => m.measurand === 'Voltage' && m.phase);
        expect(voltages).toHaveLength(3);
        for (const v of voltages) expect(v.value).toBe('230.0');
    });

    it('per-phase power sums to total', () => {
        const sum = measurands
            .filter((m) => m.measurand === 'Power.Active.Import' && m.phase)
            .reduce((s, m) => s + Number(m.value), 0);
        expect(sum).toBeCloseTo(9000, 0);
    });

    it('current = power / voltage on each phase', () => {
        const l1 = measurands.find((m) => m.measurand === 'Current.Import' && m.phase === 'L1');
        // 3kW per phase, 230V → ~13.04A
        expect(Number(l1!.value)).toBeCloseTo(3000 / 230, 1);
    });
});

describe('computeAcMeasurands — single-phase', () => {
    const measurands = computeAcMeasurands({
        totalPowerKw: 7,
        energyWh: 100,
        phaseMode: 'single-phase',
        wiring: { ...DEFAULT_AC_WIRING, phases: 1 },
    });

    it('emits exactly one phased Voltage row', () => {
        expect(measurands.filter((m) => m.measurand === 'Voltage').map((v) => v.phase)).toEqual(['L1']);
    });

    it('all power is on L1', () => {
        const l1 = measurands.find((m) => m.measurand === 'Power.Active.Import' && m.phase === 'L1');
        expect(l1?.value).toBe('7000');
    });
});

describe('computeAcMeasurands — line-to-line', () => {
    it('adds three L-L Voltage entries when reportLineToLine is true', () => {
        const m = computeAcMeasurands({
            totalPowerKw: 0,
            energyWh: 0,
            phaseMode: 'balanced',
            wiring: { ...DEFAULT_AC_WIRING, reportLineToLine: true },
        });
        const ll = m.filter((x) => x.measurand === 'Voltage' && x.phase?.includes('-'));
        expect(ll.map((x) => x.phase)).toEqual(['L1-L2', 'L2-L3', 'L3-L1']);
        for (const v of ll) expect(v.value).toBe('400.0');
    });

    it('does not add L-L entries on a single-phase device', () => {
        const m = computeAcMeasurands({
            totalPowerKw: 0,
            energyWh: 0,
            phaseMode: 'single-phase',
            wiring: { ...DEFAULT_AC_WIRING, phases: 1, reportLineToLine: true },
        });
        expect(m.filter((x) => x.phase?.includes('-'))).toHaveLength(0);
    });
});

describe('computeDcMeasurands', () => {
    it('includes SoC as a Percent measurand on the EV side', () => {
        const { measurands } = computeDcMeasurands({
            profile: DEFAULT_DC_PROFILE,
            elapsedSec: 100,
            energyWh: 0,
        });
        const soc = measurands.find((m) => m.measurand === 'SoC');
        expect(soc?.unit).toBe('Percent');
        expect(soc?.location).toBe('EV');
    });

    it('reports voltage / current / power tied to the curve', () => {
        const { measurands, frame } = computeDcMeasurands({
            profile: DEFAULT_DC_PROFILE,
            elapsedSec: 100,
            energyWh: 0,
        });
        expect(measurands.find((m) => m.measurand === 'Voltage')?.value).toBe(frame.voltageV.toFixed(1));
        expect(measurands.find((m) => m.measurand === 'Current.Import')?.value).toBe(frame.currentA.toFixed(2));
        expect(measurands.find((m) => m.measurand === 'Power.Active.Import')?.value).toBe(
            String(Math.round(frame.powerW)),
        );
    });
});

describe('filterMeasurands', () => {
    const m = computeAcMeasurands({
        totalPowerKw: 9,
        energyWh: 1000,
        phaseMode: 'balanced',
        wiring: DEFAULT_AC_WIRING,
    });

    it('returns all when CSV is empty', () => {
        expect(filterMeasurands(m, '')).toEqual(m);
        expect(filterMeasurands(m, undefined)).toEqual(m);
        expect(filterMeasurands(m, null)).toEqual(m);
    });

    it('keeps only listed measurands', () => {
        const filtered = filterMeasurands(m, 'Energy.Active.Import.Register,Power.Active.Import');
        const names = new Set(filtered.map((x) => x.measurand));
        expect(names.has('Voltage')).toBe(false);
        expect(names.has('Current.Import')).toBe(false);
        expect(names.has('Energy.Active.Import.Register')).toBe(true);
        expect(names.has('Power.Active.Import')).toBe(true);
    });

    it('ignores unknown names in the CSV', () => {
        const filtered = filterMeasurands(m, 'Power.Active.Import,Bogus.Measurand');
        expect(filtered.every((x) => x.measurand === 'Power.Active.Import')).toBe(true);
    });
});
