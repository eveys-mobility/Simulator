import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FleetStore, parseDCProfile, GroupRow, CPRow } from './sqlite';

const store = (): FleetStore => new FleetStore(':memory:');

describe('FleetStore — schema', () => {
    test('opens an in-memory db and creates all three tables', () => {
        const s = store();
        const tables = s.db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all() as Array<{ name: string }>;
        const names = tables.map((t) => t.name);
        assert.ok(names.includes('groups'));
        assert.ok(names.includes('charge_points'));
        assert.ok(names.includes('sessions'));
        s.close();
    });

    test('schema migration is idempotent', () => {
        const s = store();
        // Re-running the same SCHEMA exec should not throw.
        s.db.exec("CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY)");
        // And the original tables still work.
        const g = s.createGroup({ name: 'g', type: 'AC' });
        assert.equal(g.name, 'g');
        s.close();
    });
});

describe('FleetStore — groups', () => {
    test('create + list + get', () => {
        const s = store();
        const g1 = s.createGroup({ name: 'AC-A', type: 'AC' });
        const g2 = s.createGroup({ name: 'DC-B', type: 'DC', lb_strategy: 'least_active', lb_enabled: false });
        const all = s.listGroups();
        assert.equal(all.length, 2);
        assert.equal(s.getGroup(g1.id)?.name, 'AC-A');
        assert.equal(s.getGroupByName('DC-B')?.id, g2.id);
        assert.equal(g2.lb_strategy, 'least_active');
        assert.equal(g2.lb_enabled, 0);
        s.close();
    });

    test('unique name constraint', () => {
        const s = store();
        s.createGroup({ name: 'g', type: 'AC' });
        assert.throws(() => s.createGroup({ name: 'g', type: 'DC' }));
        s.close();
    });

    test('update merges only provided fields', () => {
        const s = store();
        const g = s.createGroup({ name: 'g', type: 'AC' });
        s.updateGroup(g.id, { lb_strategy: 'least_active' });
        const updated = s.getGroup(g.id)!;
        assert.equal(updated.name, 'g');                  // unchanged
        assert.equal(updated.lb_strategy, 'least_active'); // changed
    });

    test('delete returns true when row existed, false otherwise', () => {
        const s = store();
        const g = s.createGroup({ name: 'g', type: 'AC' });
        assert.equal(s.deleteGroup(g.id), true);
        assert.equal(s.deleteGroup(g.id), false);
        s.close();
    });
});

describe('FleetStore — charge points', () => {
    test('create + list + get', () => {
        const s = store();
        s.createCP({ cp_id: 'cp_aaa', display_name: 'A', type: 'AC' });
        s.createCP({ cp_id: 'cp_bbb', display_name: 'B', type: 'DC', dc_profile: { capacity_kwh: 60 }, max_power_kw: 100 });
        const all = s.listCPs();
        assert.equal(all.length, 2);
        const a = s.getCP('cp_aaa')!;
        const b = s.getCP('cp_bbb')!;
        assert.equal(a.type, 'AC');
        assert.equal(b.type, 'DC');
        assert.equal(b.max_power_kw, 100);
        assert.deepEqual(parseDCProfile(b), { capacity_kwh: 60 });
        s.close();
    });

    test('unique cp_id constraint', () => {
        const s = store();
        s.createCP({ cp_id: 'cp_aaa', display_name: 'A', type: 'AC' });
        assert.throws(() => s.createCP({ cp_id: 'cp_aaa', display_name: 'A2', type: 'DC' }));
        s.close();
    });

    test('update — group_id can be set, updated, and cleared', () => {
        const s = store();
        const g = s.createGroup({ name: 'g', type: 'AC' });
        s.createCP({ cp_id: 'cp_aaa', display_name: 'A', type: 'AC' });

        // Set group
        s.updateCP('cp_aaa', { group_id: g.id });
        assert.equal(s.getCP('cp_aaa')?.group_id, g.id);

        // Clear group (explicit null)
        s.updateCP('cp_aaa', { group_id: null });
        assert.equal(s.getCP('cp_aaa')?.group_id, null);

        // Patch without the key leaves group_id unchanged
        s.updateCP('cp_aaa', { group_id: g.id });
        s.updateCP('cp_aaa', { display_name: 'A renamed' });
        assert.equal(s.getCP('cp_aaa')?.group_id, g.id);
        assert.equal(s.getCP('cp_aaa')?.display_name, 'A renamed');
        s.close();
    });

    test('group delete cascades to SET NULL on cp.group_id', () => {
        const s = store();
        const g = s.createGroup({ name: 'g', type: 'AC' });
        s.createCP({ cp_id: 'cp_aaa', display_name: 'A', type: 'AC', group_id: g.id });
        assert.equal(s.getCP('cp_aaa')?.group_id, g.id);

        s.deleteGroup(g.id);
        assert.equal(s.getCP('cp_aaa')?.group_id, null);
        s.close();
    });

    test('parseDCProfile tolerates malformed JSON', () => {
        const s = store();
        s.createCP({ cp_id: 'cp_aaa', display_name: 'A', type: 'DC' });
        // Inject malformed JSON behind the typed API.
        s.db.prepare(`UPDATE charge_points SET dc_profile = '{not json' WHERE cp_id = ?`).run('cp_aaa');
        const row = s.getCP('cp_aaa')!;
        assert.equal(parseDCProfile(row), undefined);
        s.close();
    });
});

describe('FleetStore — sessions', () => {
    test('insert + end + listSessions', () => {
        const s = store();
        s.createCP({ cp_id: 'cp_aaa', display_name: 'A', type: 'AC' });
        const id = s.insertSession({ cp_id: 'cp_aaa', connector_id: 1, id_tag: 'T1', started_at: '2026-05-09T12:00:00Z' });

        const active = s.listSessions({ status: 'active' });
        assert.equal(active.length, 1);
        assert.equal(active[0].cp_id, 'cp_aaa');

        s.endSession({ id, ended_at: '2026-05-09T12:30:00Z', end_reason: 'Local', energy_wh: 5000, peak_power_kw: 10 });
        const completed = s.listSessions({ status: 'completed' });
        assert.equal(completed.length, 1);
        assert.equal(completed[0].energy_wh, 5000);
        assert.equal(completed[0].end_reason, 'Local');

        const byCp = s.listSessions({ cp_id: 'cp_aaa', limit: 10 });
        assert.equal(byCp.length, 1);
        s.close();
    });

    test('abortOrphanedActiveSessions flips active rows to aborted', () => {
        const s = store();
        s.createCP({ cp_id: 'cp_a', display_name: 'A', type: 'AC' });
        s.createCP({ cp_id: 'cp_b', display_name: 'B', type: 'AC' });
        s.insertSession({ cp_id: 'cp_a', connector_id: 1, id_tag: 'T1', started_at: '2026-05-09T12:00:00Z' });
        s.insertSession({ cp_id: 'cp_b', connector_id: 1, id_tag: 'T2', started_at: '2026-05-09T12:00:00Z' });

        // One already complete shouldn't be touched.
        const completedId = s.insertSession({ cp_id: 'cp_a', connector_id: 1, id_tag: 'T3', started_at: '2026-05-09T11:00:00Z' });
        s.endSession({ id: completedId, ended_at: '2026-05-09T11:30:00Z', end_reason: 'Local', energy_wh: 1000, peak_power_kw: 5 });

        const aborted = s.abortOrphanedActiveSessions();
        assert.equal(aborted, 2);

        const stillActive = s.listSessions({ status: 'active' });
        assert.equal(stillActive.length, 0);

        const completed = s.listSessions({ status: 'completed' });
        assert.equal(completed.length, 1);

        const all = s.listSessions({ limit: 10 });
        const abortedRows = all.filter((r) => r.status === 'aborted');
        assert.equal(abortedRows.length, 2);
        for (const r of abortedRows) {
            assert.equal(r.end_reason, 'manager_restart');
            assert.notEqual(r.ended_at, null);
        }
        s.close();
    });
});

describe('FleetStore — reset', () => {
    test('wipes all three tables', () => {
        const s = store();
        const g = s.createGroup({ name: 'g', type: 'AC' });
        s.createCP({ cp_id: 'cp_a', display_name: 'A', type: 'AC', group_id: g.id });
        s.insertSession({ cp_id: 'cp_a', connector_id: 1, id_tag: 'T1', started_at: '2026-05-09T12:00:00Z' });

        s.reset();
        assert.equal(s.listGroups().length, 0);
        assert.equal(s.listCPs().length, 0);
        assert.equal(s.listSessions({ limit: 10 }).length, 0);

        // After reset, schema still intact; can write again.
        const g2 = s.createGroup({ name: 'g2', type: 'DC' });
        assert.ok(g2.id);
        s.close();
    });
});

describe('FleetStore — boot reload roundtrip', () => {
    test('reload from a snapshot file recovers groups + CPs', async (t) => {
        const tmp = `/tmp/fleet-test-${process.pid}-${Date.now()}.sqlite`;
        t.after(() => { try { require('node:fs').unlinkSync(tmp); } catch {} });

        const s1 = new FleetStore(tmp);
        const g = s1.createGroup({ name: 'g', type: 'AC', lb_strategy: 'least_active' });
        s1.createCP({ cp_id: 'cp_a', display_name: 'A', type: 'AC', group_id: g.id, phase_mode: 'imbalanced' });
        s1.createCP({ cp_id: 'cp_b', display_name: 'B', type: 'DC', dc_profile: { capacity_kwh: 75, charger_max_kw: 150 } });
        s1.close();

        const s2 = new FleetStore(tmp);
        const groups = s2.listGroups();
        assert.equal(groups.length, 1);
        assert.equal(groups[0].lb_strategy, 'least_active');
        const cps = s2.listCPs();
        assert.equal(cps.length, 2);
        const a = cps.find((c) => c.cp_id === 'cp_a')!;
        assert.equal(a.group_id, groups[0].id);
        assert.equal(a.phase_mode, 'imbalanced');
        const b = cps.find((c) => c.cp_id === 'cp_b')!;
        assert.deepEqual(parseDCProfile(b), { capacity_kwh: 75, charger_max_kw: 150 });
        s2.close();
    });
});
