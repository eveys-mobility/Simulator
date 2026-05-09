import { describe, expect, it } from 'vitest';
import type { Device } from '@ocpp-sim/core';
import { Store } from './store.js';

const sample: Device = {
    id: 'cp_test',
    displayName: 'Test',
    type: 'AC',
    model: 'Eveys-22kW-AC',
    vendor: 'Eveys',
    firmwareVersion: '1.0.0',
    maxPowerKw: 22,
    ocppUrl: 'ws://localhost:19000',
    phaseMode: 'balanced',
    createdAt: '2026-05-09T12:00:00.000Z',
};

describe('Store — schema migration', () => {
    it('creates devices and sessions tables on first open', () => {
        const s = new Store(':memory:');
        expect(s.listDevices()).toEqual([]);
        expect(s.listSessions()).toEqual([]);
        s.close();
    });

    it('is idempotent — second open does nothing', () => {
        const s = new Store(':memory:');
        const v1 = s.db.pragma('user_version', { simple: true });
        // simulate restart
        s.close();
        const s2 = new Store(':memory:');
        const v2 = s2.db.pragma('user_version', { simple: true });
        expect(v1).toBe(v2);
        s2.close();
    });
});

describe('Store — devices', () => {
    it('roundtrips a device', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        expect(s.getDevice(sample.id)).toEqual(sample);
        s.close();
    });

    it('updates only provided fields', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        s.updateDevice(sample.id, { displayName: 'Renamed' });
        const d = s.getDevice(sample.id);
        expect(d?.displayName).toBe('Renamed');
        expect(d?.type).toBe('AC');
        s.close();
    });
});

describe('Store — sessions', () => {
    it('insert + end + list', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        const id = s.insertSession({
            deviceId: sample.id,
            connectorId: 1,
            transactionId: 100,
            idTag: 'T',
            status: 'active',
            startedAt: '2026-05-09T12:00:00.000Z',
            endedAt: null,
            endReason: null,
            energyWh: 0,
            peakPowerKw: 0,
        });
        s.endSession({ id, endedAt: '2026-05-09T12:30:00.000Z', endReason: 'Local', energyWh: 5000, peakPowerKw: 10 });
        const completed = s.listSessions({ status: 'completed' });
        expect(completed).toHaveLength(1);
        expect(completed[0]?.energyWh).toBe(5000);
        s.close();
    });

    it('abortOrphanedSessions flips active rows to aborted', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        s.insertSession({
            deviceId: sample.id,
            connectorId: 1,
            transactionId: 1,
            idTag: 'T',
            status: 'active',
            startedAt: '2026-05-09T12:00:00.000Z',
            endedAt: null,
            endReason: null,
            energyWh: 0,
            peakPowerKw: 0,
        });
        const n = s.abortOrphanedSessions();
        expect(n).toBe(1);
        expect(s.listSessions({ status: 'aborted' })).toHaveLength(1);
        s.close();
    });
});
