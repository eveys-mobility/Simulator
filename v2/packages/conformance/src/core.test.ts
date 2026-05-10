import { describe, it } from 'vitest';
import { CORE_CASES } from './cases/core.js';
import { runConformanceCase } from './runner.js';

/**
 * One Vitest test per conformance case. Vitest gives us reporting,
 * timeouts, parallelism, and integration with the existing `npm test`
 * suite for free — the case definitions stay declarative and a future
 * SPA-side runner can read the same CORE_CASES array to render
 * pass/fail without going through Vitest at all.
 */
describe('OCPP 1.6 Core conformance', () => {
    for (const c of CORE_CASES) {
        it(`${c.id} — ${c.title}`, async () => {
            await runConformanceCase(c);
        });
    }
});
