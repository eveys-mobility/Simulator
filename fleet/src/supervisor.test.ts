import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from './registry';
import { WorkerSupervisor } from './supervisor';
import { FleetStore } from './sqlite';
import { UpMessage } from './protocol';

/**
 * These tests reach inside the supervisor to verify its UpMessage →
 * registry + sqlite plumbing without spawning real worker_threads.
 * That's the right level of coverage here: spawning + worker
 * lifecycle is exercised by the e2e smoke; the in-memory wiring
 * benefits from a direct unit test.
 *
 * We use the (private) applyUpMessage via a small bracket trick so
 * we can drive Up messages synchronously. The handle param is a
 * dummy with just enough shape to satisfy the function — it doesn't
 * touch the worker thread.
 */
const driveUp = (sup: WorkerSupervisor, cpId: string, msg: UpMessage): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sup as any).applyUpMessage(cpId, msg, { worker: null, restart_attempts: 0 });
};

const seed = (registry: Registry, store: FleetStore, cpId: string): void => {
    store.createCP({ cp_id: cpId, display_name: 'Test', type: 'AC' });
    registry.upsert({
        cp_id: cpId,
        display_name: 'Test',
        type: 'AC',
        worker_alive: true,
        online: false,
        connector_status: { 1: 'Unknown' },
        active_sessions: { 1: null },
        last_tick: {},
    });
};

describe('WorkerSupervisor — heartbeat tracking', () => {
    test('pong message updates last_pong_at on the handle', () => {
        const registry = new Registry();
        const store = new FleetStore(':memory:');
        const sup = new WorkerSupervisor({ registry, store });
        seed(registry, store, 'cp_aaa');

        const handle: any = { worker: null, restart_attempts: 0, last_pong_at: 1000 };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sup as any).applyUpMessage('cp_aaa', { type: 'pong', nonce: 42 }, handle);
        // last_pong_at should now be Date.now() (much greater than 1000)
        assert.ok(handle.last_pong_at > 1000, `expected updated last_pong_at, got ${handle.last_pong_at}`);

        store.close();
    });

    test('checkWorkerLiveness terminates a stale worker', () => {
        const registry = new Registry();
        const store = new FleetStore(':memory:');
        const sup = new WorkerSupervisor({ registry, store });
        seed(registry, store, 'cp_aaa');

        let terminated = false;
        const handle: any = {
            worker: { terminate: async () => { terminated = true; } },
            restart_attempts: 0,
            last_pong_at: Date.now() - 60_000, // 60 s of silence
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sup as any).checkWorkerLiveness('cp_aaa', handle);
        assert.equal(terminated, true);

        store.close();
    });

    test('checkWorkerLiveness leaves a healthy worker alone', () => {
        const registry = new Registry();
        const store = new FleetStore(':memory:');
        const sup = new WorkerSupervisor({ registry, store });
        seed(registry, store, 'cp_aaa');

        let terminated = false;
        const handle: any = {
            worker: { terminate: async () => { terminated = true; } },
            restart_attempts: 0,
            last_pong_at: Date.now() - 5_000, // 5 s — well within budget
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sup as any).checkWorkerLiveness('cp_aaa', handle);
        assert.equal(terminated, false);

        store.close();
    });
});

describe('WorkerSupervisor — session persistence', () => {
    test('session_started writes a row; session_ended completes it with peak power', () => {
        const registry = new Registry();
        const store = new FleetStore(':memory:');
        const sup = new WorkerSupervisor({ registry, store });
        seed(registry, store, 'cp_aaa');

        driveUp(sup, 'cp_aaa', { type: 'connected' });
        driveUp(sup, 'cp_aaa', {
            type: 'session_started',
            connector_id: 1,
            transaction_id: 100,
            id_tag: 'TAG_X',
        });

        const active = store.listSessions({ status: 'active' });
        assert.equal(active.length, 1);
        assert.equal(active[0].cp_id, 'cp_aaa');
        assert.equal(active[0].id_tag, 'TAG_X');
        assert.equal(registry.get('cp_aaa')?.active_sessions[1], 100);

        // Two ticks: peak should be the first (10.5 kW), not the second (5.0 kW).
        driveUp(sup, 'cp_aaa', { type: 'meter_tick', connector_id: 1, power_kw: 10.5, energy_kwh: 0.01 });
        driveUp(sup, 'cp_aaa', { type: 'meter_tick', connector_id: 1, power_kw: 5.0, energy_kwh: 0.02 });

        driveUp(sup, 'cp_aaa', {
            type: 'session_ended',
            connector_id: 1,
            transaction_id: 100,
            energy_wh: 1500,
            peak_power_kw: 5.0,    // worker reports last; supervisor should override with running peak
            reason: 'Local',
        });

        const completed = store.listSessions({ status: 'completed' });
        assert.equal(completed.length, 1);
        assert.equal(completed[0].energy_wh, 1500);
        assert.equal(completed[0].end_reason, 'Local');
        assert.equal(completed[0].peak_power_kw, 10.5);
        assert.equal(registry.get('cp_aaa')?.active_sessions[1], null);

        store.close();
    });

    test('connected/disconnected toggle online flag', () => {
        const registry = new Registry();
        const store = new FleetStore(':memory:');
        const sup = new WorkerSupervisor({ registry, store });
        seed(registry, store, 'cp_aaa');

        driveUp(sup, 'cp_aaa', { type: 'connected' });
        assert.equal(registry.get('cp_aaa')?.online, true);
        driveUp(sup, 'cp_aaa', { type: 'disconnected' });
        assert.equal(registry.get('cp_aaa')?.online, false);

        store.close();
    });

    test('connector_status patches the right connector', () => {
        const registry = new Registry();
        const store = new FleetStore(':memory:');
        const sup = new WorkerSupervisor({ registry, store });
        seed(registry, store, 'cp_aaa');

        driveUp(sup, 'cp_aaa', { type: 'connector_status', connector_id: 1, status: 'Charging' });
        assert.equal(registry.get('cp_aaa')?.connector_status[1], 'Charging');

        store.close();
    });

    test('meter_tick updates last_tick + tracks peak even before session_ended', () => {
        const registry = new Registry();
        const store = new FleetStore(':memory:');
        const sup = new WorkerSupervisor({ registry, store });
        seed(registry, store, 'cp_aaa');

        driveUp(sup, 'cp_aaa', {
            type: 'session_started',
            connector_id: 1,
            transaction_id: 1,
            id_tag: 'T',
        });
        driveUp(sup, 'cp_aaa', { type: 'meter_tick', connector_id: 1, power_kw: 7.5, energy_kwh: 0.1 });
        const last = registry.get('cp_aaa')?.last_tick[1];
        assert.equal(last?.power_kw, 7.5);
        store.close();
    });
});
