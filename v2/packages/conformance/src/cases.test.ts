import { describe, it } from 'vitest';
import {
    ALL_CASES,
    CONCURRENT_TX_CASES,
    CORE_CASES,
    FIRMWARE_MANAGEMENT_CASES,
    LOCAL_AUTH_LIST_CASES,
    NEGATIVE_CASES,
    REMOTE_TRIGGER_CASES,
    RESERVATION_CASES,
    SMART_CHARGING_CASES,
} from './index.js';
import { runConformanceCase } from './runner.js';

/**
 * One Vitest test per conformance case. Vitest gives us reporting,
 * timeouts, parallelism, and integration with the existing `npm test`
 * suite for free — the case definitions stay declarative and a future
 * SPA-side runner can read the same arrays to render pass/fail
 * without going through Vitest at all.
 *
 * Cases are grouped by profile in the test output so a CSMS team
 * can scan "Core: 20/20, SmartCharging: 7/7, RemoteTrigger: 5/5"
 * at a glance.
 */
describe('OCPP 1.6 Core conformance', () => {
    for (const c of CORE_CASES) {
        it(`${c.id} — ${c.title}`, async () => {
            await runConformanceCase(c);
        });
    }
});

describe('OCPP 1.6 ConcurrentTx (§5.5)', () => {
    for (const c of CONCURRENT_TX_CASES) {
        it(`${c.id} — ${c.title}`, async () => {
            await runConformanceCase(c);
        });
    }
});

describe('OCPP 1.6 SmartCharging conformance', () => {
    for (const c of SMART_CHARGING_CASES) {
        it(`${c.id} — ${c.title}`, async () => {
            await runConformanceCase(c);
        });
    }
});

describe('OCPP 1.6 RemoteTrigger conformance', () => {
    for (const c of REMOTE_TRIGGER_CASES) {
        it(`${c.id} — ${c.title}`, async () => {
            await runConformanceCase(c);
        });
    }
});

describe('OCPP 1.6 Reservation conformance', () => {
    for (const c of RESERVATION_CASES) {
        it(`${c.id} — ${c.title}`, async () => {
            await runConformanceCase(c);
        });
    }
});

describe('OCPP 1.6 LocalAuthListManagement conformance', () => {
    for (const c of LOCAL_AUTH_LIST_CASES) {
        it(`${c.id} — ${c.title}`, async () => {
            await runConformanceCase(c);
        });
    }
});

describe('OCPP 1.6 FirmwareManagement conformance', () => {
    for (const c of FIRMWARE_MANAGEMENT_CASES) {
        it(`${c.id} — ${c.title}`, async () => {
            await runConformanceCase(c);
        });
    }
});

describe('OCPP 1.6 negative / failure-injection', () => {
    for (const c of NEGATIVE_CASES) {
        it(`${c.id} — ${c.title}`, async () => {
            await runConformanceCase(c);
        });
    }
});

describe('ALL_CASES integrity', () => {
    it('contains every per-profile array exactly once with unique ids', () => {
        const expected =
            CORE_CASES.length +
            CONCURRENT_TX_CASES.length +
            SMART_CHARGING_CASES.length +
            REMOTE_TRIGGER_CASES.length +
            RESERVATION_CASES.length +
            LOCAL_AUTH_LIST_CASES.length +
            FIRMWARE_MANAGEMENT_CASES.length +
            NEGATIVE_CASES.length;
        if (ALL_CASES.length !== expected) {
            throw new Error(
                `ALL_CASES has ${ALL_CASES.length} entries; profile arrays sum to ${expected}`,
            );
        }
        const ids = new Set<string>();
        for (const c of ALL_CASES) {
            if (ids.has(c.id)) throw new Error(`duplicate case id: ${c.id}`);
            ids.add(c.id);
        }
    });
});
