import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, generateCPId, CPRecord } from './registry';

const sample = (cpId: string): CPRecord => ({
    cp_id: cpId,
    display_name: 'Test CP',
    type: 'AC',
    worker_alive: true,
    online: false,
    connector_status: {},
    active_sessions: { 1: null },
    last_tick: {},
});

describe('Registry', () => {
    test('upsert + get + list', () => {
        const r = new Registry();
        r.upsert(sample('cp_aaa'));
        r.upsert(sample('cp_bbb'));
        assert.equal(r.get('cp_aaa')?.cp_id, 'cp_aaa');
        assert.equal(r.list().length, 2);
    });

    test('upsert overwrites existing', () => {
        const r = new Registry();
        r.upsert(sample('cp_aaa'));
        r.upsert({ ...sample('cp_aaa'), online: true });
        assert.equal(r.get('cp_aaa')?.online, true);
    });

    test('patch merges nested record fields', () => {
        const r = new Registry();
        r.upsert(sample('cp_aaa'));
        r.patch('cp_aaa', { connector_status: { 1: 'Charging' } });
        r.patch('cp_aaa', { connector_status: { 2: 'Available' } });
        const got = r.get('cp_aaa');
        // Both keys preserved across the two patches.
        assert.deepEqual(got?.connector_status, { 1: 'Charging', 2: 'Available' });
    });

    test('patch on unknown cp returns undefined and does not insert', () => {
        const r = new Registry();
        const result = r.patch('cp_ghost', { online: true });
        assert.equal(result, undefined);
        assert.equal(r.list().length, 0);
    });

    test('remove + list', () => {
        const r = new Registry();
        r.upsert(sample('cp_aaa'));
        assert.equal(r.remove('cp_aaa'), true);
        assert.equal(r.remove('cp_aaa'), false);
        assert.equal(r.list().length, 0);
    });

    test('activeSessionCount counts non-null values', () => {
        const r = new Registry();
        r.upsert({
            ...sample('cp_dc'),
            type: 'DC',
            active_sessions: { 1: 42, 2: null },
        });
        assert.equal(r.activeSessionCount('cp_dc'), 1);
        r.patch('cp_dc', { active_sessions: { 2: 43 } });
        assert.equal(r.activeSessionCount('cp_dc'), 2);
        r.patch('cp_dc', { active_sessions: { 1: null } });
        assert.equal(r.activeSessionCount('cp_dc'), 1);
    });

    test('activeSessionCount on unknown cp returns 0', () => {
        const r = new Registry();
        assert.equal(r.activeSessionCount('cp_ghost'), 0);
    });
});

describe('generateCPId', () => {
    test('matches cp_<6 hex> shape', () => {
        for (let i = 0; i < 50; i++) {
            const id = generateCPId();
            assert.match(id, /^cp_[0-9a-f]{6}$/);
        }
    });
});
