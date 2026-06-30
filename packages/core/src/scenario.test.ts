import { describe, expect, it } from 'vitest';
import { SCENARIO_PRESETS, ScenarioSchema } from './scenario.js';

describe('Scenario', () => {
    it('parses a minimal scenario, filling defaults', () => {
        const r = ScenarioSchema.parse({
            name: 'Tiny',
            deviceCount: 1,
            totalDurationSeconds: 60,
        });
        expect(r.deviceMix).toBe('AC');
        expect(r.rampUpSeconds).toBe(10);
        expect(r.autoCleanup).toBe(true);
    });

    it('rejects deviceCount above 500 (memory cap)', () => {
        const r = ScenarioSchema.safeParse({
            name: 'Huge',
            deviceCount: 501,
            totalDurationSeconds: 60,
        });
        expect(r.success).toBe(false);
    });

    it('rejects deviceCount below 1', () => {
        expect(
            ScenarioSchema.safeParse({ name: 'Zero', deviceCount: 0, totalDurationSeconds: 60 })
                .success,
        ).toBe(false);
    });

    it('every preset is a valid scenario', () => {
        for (const p of SCENARIO_PRESETS) {
            expect(ScenarioSchema.safeParse(p.scenario).success).toBe(true);
        }
    });
});
