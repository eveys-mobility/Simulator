import { describe, expect, it } from 'vitest';
import type { ConformanceCase } from './runner.js';
import { runConformanceSuite } from './runner.js';

/**
 * The suite runner is the contract every consumer (REST endpoint,
 * SPA renderer, CI gate) reads. Its shape is load-bearing — these
 * tests exist to keep it stable.
 */

const passingCase: ConformanceCase = {
    id: 'fake.passes',
    title: 'always passes',
    profile: 'Core',
    run: async () => undefined,
};

const failingCase: ConformanceCase = {
    id: 'fake.fails',
    title: 'always fails',
    profile: 'Core',
    run: async () => {
        throw new Error('intentional failure');
    },
};

describe('runConformanceSuite', () => {
    it('returns aggregate counts and per-case rows in input order', async () => {
        const r = await runConformanceSuite([passingCase, failingCase, passingCase]);
        expect(r.passed).toBe(2);
        expect(r.failed).toBe(1);
        expect(r.cases.map((c) => c.status)).toEqual(['passed', 'failed', 'passed']);
        expect(r.cases.map((c) => c.id)).toEqual(['fake.passes', 'fake.fails', 'fake.passes']);
        expect(r.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('failed cases carry the error message; passed cases have null error', async () => {
        const r = await runConformanceSuite([passingCase, failingCase]);
        expect(r.cases[0]?.error).toBeNull();
        expect(r.cases[1]?.error).toContain('intentional failure');
    });

    it('does not throw — even when every case fails', async () => {
        const r = await runConformanceSuite([failingCase, failingCase]);
        expect(r.passed).toBe(0);
        expect(r.failed).toBe(2);
    });

    it('preserves case metadata for renderers (title, profile)', async () => {
        const r = await runConformanceSuite([passingCase]);
        expect(r.cases[0]?.title).toBe('always passes');
        expect(r.cases[0]?.profile).toBe('Core');
    });
});
