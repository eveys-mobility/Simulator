import type { Device } from '@ocpp-sim/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceManager } from './device-manager.js';
import { Store } from './store.js';

const newMgr = (): { mgr: DeviceManager; store: Store } => {
    const store = new Store(':memory:');
    return { mgr: new DeviceManager(store), store };
};

// Use an unreachable gateway URL so OcppClient never actually connects.
// `spawn` resolves regardless because the supervisor catches connect
// failures and surfaces them as `errored` events.
const UNREACHABLE = 'ws://127.0.0.1:1';

const sample = (overrides: Partial<Device> = {}): Device => ({
    id: 'cp_dm_test',
    displayName: 'DM Test',
    type: 'AC',
    model: 'Eveys-22kW-AC',
    vendor: 'Eveys',
    firmwareVersion: '1.0.0',
    maxPowerKw: 22,
    ocppUrl: UNREACHABLE,
    phaseMode: 'balanced',
    createdAt: '2026-05-09T12:00:00.000Z',
    ...overrides,
});

describe('DeviceManager', () => {
    afterEach(() => vi.useRealTimers());

    it('spawns a sim and lists it', async () => {
        const { mgr, store } = newMgr();
        const d = sample();
        store.insertDevice(d);
        await mgr.spawn(d);
        expect(mgr.list()).toHaveLength(1);
        expect(mgr.get(d.id)?.device.id).toBe(d.id);
        await mgr.stopAll();
    });

    it('despawn removes the sim', async () => {
        const { mgr, store } = newMgr();
        const d = sample();
        store.insertDevice(d);
        await mgr.spawn(d);
        await mgr.despawn(d.id);
        expect(mgr.list()).toHaveLength(0);
        expect(mgr.get(d.id)).toBeUndefined();
    });

    it('respawn replaces the sim with the new device row', async () => {
        const { mgr, store } = newMgr();
        const original = sample({ displayName: 'Original' });
        store.insertDevice(original);
        await mgr.spawn(original);
        const firstSim = mgr.get(original.id);
        const updated = { ...original, displayName: 'Updated', maxPowerKw: 11 };
        await mgr.respawn(updated);
        const secondSim = mgr.get(original.id);
        expect(secondSim).toBeDefined();
        expect(secondSim).not.toBe(firstSim); // new instance
        expect(secondSim?.device.displayName).toBe('Updated');
        expect(secondSim?.device.maxPowerKw).toBe(11);
        await mgr.stopAll();
    });

    it('hasActiveSession is false when nothing is running', async () => {
        const { mgr, store } = newMgr();
        const d = sample();
        store.insertDevice(d);
        await mgr.spawn(d);
        expect(mgr.hasActiveSession(d.id)).toBe(false);
        await mgr.stopAll();
    });

    it('hasActiveSession is false for unknown device', () => {
        const { mgr } = newMgr();
        expect(mgr.hasActiveSession('does-not-exist')).toBe(false);
    });
});
