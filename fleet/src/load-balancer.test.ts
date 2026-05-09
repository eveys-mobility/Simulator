import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pickCp } from './load-balancer';
import { Registry, CPRecord } from './registry';
import { GroupRow, CPRow } from './sqlite';

const group = (overrides: Partial<GroupRow> = {}): GroupRow => ({
    id: 1,
    name: 'g',
    type: 'AC',
    lb_strategy: 'round_robin',
    lb_enabled: 1,
    lb_round_robin_cursor: 0,
    created_at: '2026-05-09T00:00:00Z',
    ...overrides,
});

const cp = (cp_id: string, overrides: Partial<CPRow> = {}): CPRow => ({
    id: 1,
    cp_id,
    display_name: cp_id,
    type: 'AC',
    group_id: 1,
    phase_mode: null,
    dc_profile: null,
    max_power_kw: null,
    ocpp_url: null,
    created_at: '2026-05-09T00:00:00Z',
    ...overrides,
});

const seedRecord = (
    registry: Registry,
    cp_id: string,
    overrides: Partial<CPRecord> = {},
): void => {
    registry.upsert({
        cp_id,
        display_name: cp_id,
        type: 'AC',
        worker_alive: true,
        online: true,
        connector_status: { 1: 'Available' },
        active_sessions: { 1: null },
        last_tick: {},
        ...overrides,
    });
};

describe('pickCp — round_robin', () => {
    test('cycles through candidates in cp_id-sorted order', () => {
        const r = new Registry();
        seedRecord(r, 'cp_a');
        seedRecord(r, 'cp_b');
        seedRecord(r, 'cp_c');
        const candidates = [cp('cp_b'), cp('cp_a'), cp('cp_c')];
        const g = group();

        const seen: string[] = [];
        for (let i = 0; i < 6; i++) {
            const pick = pickCp({ group: g, candidates, registry: r, cursor: i });
            seen.push(pick!.cp_id);
        }
        // Sorted candidates: cp_a, cp_b, cp_c. Cursor 0..5 → a,b,c,a,b,c.
        assert.deepEqual(seen, ['cp_a', 'cp_b', 'cp_c', 'cp_a', 'cp_b', 'cp_c']);
    });

    test('picks lowest free connector on the chosen CP', () => {
        const r = new Registry();
        seedRecord(r, 'cp_a', {
            connector_status: { 1: 'Charging', 2: 'Available', 3: 'Available' },
            active_sessions: { 1: 100, 2: null, 3: null },
        });
        const pick = pickCp({ group: group(), candidates: [cp('cp_a')], registry: r });
        assert.equal(pick?.connector_id, 2);
    });

    test('skips offline workers', () => {
        const r = new Registry();
        seedRecord(r, 'cp_a', { online: false });
        seedRecord(r, 'cp_b');
        const pick = pickCp({ group: group(), candidates: [cp('cp_a'), cp('cp_b')], registry: r });
        assert.equal(pick?.cp_id, 'cp_b');
    });

    test('skips workers whose connectors are all busy', () => {
        const r = new Registry();
        seedRecord(r, 'cp_a', {
            connector_status: { 1: 'Charging' },
            active_sessions: { 1: 100 },
        });
        seedRecord(r, 'cp_b');
        const pick = pickCp({ group: group(), candidates: [cp('cp_a'), cp('cp_b')], registry: r });
        assert.equal(pick?.cp_id, 'cp_b');
    });

    test('returns null when nothing fits', () => {
        const r = new Registry();
        seedRecord(r, 'cp_a', { online: false });
        const pick = pickCp({ group: group(), candidates: [cp('cp_a')], registry: r });
        assert.equal(pick, null);
    });

    test('returns null on empty group', () => {
        const r = new Registry();
        const pick = pickCp({ group: group(), candidates: [], registry: r });
        assert.equal(pick, null);
    });
});

describe('pickCp — least_active', () => {
    test('picks the CP with fewest active sessions', () => {
        const r = new Registry();
        seedRecord(r, 'cp_a', {
            connector_status: { 1: 'Charging', 2: 'Available' },
            active_sessions: { 1: 100, 2: null },
        });
        seedRecord(r, 'cp_b'); // 0 active
        seedRecord(r, 'cp_c', {
            connector_status: { 1: 'Charging', 2: 'Charging' },
            active_sessions: { 1: 200, 2: 201 },
        }); // 2 active, but no free → ineligible anyway

        const pick = pickCp({
            group: group({ lb_strategy: 'least_active' }),
            candidates: [cp('cp_a'), cp('cp_b'), cp('cp_c')],
            registry: r,
        });
        assert.equal(pick?.cp_id, 'cp_b');
    });

    test('breaks ties by cp_id (lexicographic)', () => {
        const r = new Registry();
        seedRecord(r, 'cp_b'); // 0 active
        seedRecord(r, 'cp_a'); // 0 active — tie → wins on cp_id
        seedRecord(r, 'cp_c'); // 0 active

        const pick = pickCp({
            group: group({ lb_strategy: 'least_active' }),
            candidates: [cp('cp_b'), cp('cp_a'), cp('cp_c')],
            registry: r,
        });
        assert.equal(pick?.cp_id, 'cp_a');
    });

    test('an ineligible cp with low active count loses to an eligible one with higher count', () => {
        const r = new Registry();
        // cp_a has 0 active sessions but is offline (ineligible).
        seedRecord(r, 'cp_a', { online: false });
        // cp_b has 1 active session but is eligible (one free connector).
        seedRecord(r, 'cp_b', {
            connector_status: { 1: 'Charging', 2: 'Available' },
            active_sessions: { 1: 100, 2: null },
        });
        const pick = pickCp({
            group: group({ lb_strategy: 'least_active' }),
            candidates: [cp('cp_a'), cp('cp_b')],
            registry: r,
        });
        assert.equal(pick?.cp_id, 'cp_b');
    });
});
