import { describe, expect, it } from 'vitest';
import type { Device } from '@ocpp-sim/core';
import { Simulator } from './simulator.js';
import { Store } from './store.js';

const UNREACHABLE = 'ws://127.0.0.1:1';

const sampleAC: Device = {
    id: 'cp_sim_ac',
    displayName: 'Sim AC',
    type: 'AC',
    model: 'Eveys-22kW-AC',
    vendor: 'Eveys',
    firmwareVersion: '1.0.0',
    maxPowerKw: 22,
    ocppUrl: UNREACHABLE,
    phaseMode: 'balanced',
    createdAt: '2026-05-09T12:00:00.000Z',
};

const newSim = (d: Device = sampleAC): { sim: Simulator; store: Store } => {
    const store = new Store(':memory:');
    store.insertDevice(d);
    const sim = new Simulator(d, store);
    return { sim, store };
};

describe('Simulator — CSMS call handling', () => {
    it('GetConfiguration with no keys returns all known keys', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('GetConfiguration', {});
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const result = r.result as { configurationKey: { key: string }[]; unknownKey: string[] };
        expect(result.configurationKey.length).toBeGreaterThan(20);
        expect(result.unknownKey).toEqual([]);
        sim.stop();
    });

    it('GetConfiguration with specific keys filters', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('GetConfiguration', { key: ['HeartbeatInterval', 'NoSuchKey'] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const result = r.result as { configurationKey: { key: string; value?: string }[]; unknownKey: string[] };
        expect(result.configurationKey).toHaveLength(1);
        expect(result.configurationKey[0]?.key).toBe('HeartbeatInterval');
        expect(result.unknownKey).toEqual(['NoSuchKey']);
        sim.stop();
    });

    it('ChangeConfiguration Accepted on a writable key', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('ChangeConfiguration', { key: 'HeartbeatInterval', value: '120' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('Accepted');
        sim.stop();
    });

    it('ChangeConfiguration Rejected on a readonly key', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('ChangeConfiguration', { key: 'NumberOfConnectors', value: '5' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('Rejected');
        sim.stop();
    });

    it('ChangeConfiguration NotSupported on an unknown key', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('ChangeConfiguration', { key: 'BogusKey', value: 'x' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('NotSupported');
        sim.stop();
    });

    it('Reset Accepted (defers actual reset)', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('Reset', { type: 'Soft' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('Accepted');
        sim.stop();
    });

    it('ChangeAvailability flips Operative flag for an idle connector', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('ChangeAvailability', { connectorId: 1, type: 'Inoperative' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('Accepted');
        const snap = sim.snapshot();
        expect(snap.connectors[0]?.status).toBe('Unavailable');
        sim.stop();
    });

    it('ChangeAvailability rejects bad type', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('ChangeAvailability', { connectorId: 1, type: 'Maybe' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('Rejected');
        sim.stop();
    });

    it('UnlockConnector Unlocked for a known connector', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('UnlockConnector', { connectorId: 1 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('Unlocked');
        sim.stop();
    });

    it('UnlockConnector NotSupported for an unknown connector', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('UnlockConnector', { connectorId: 99 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('NotSupported');
        sim.stop();
    });

    it('DataTransfer Accepted for own vendor', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('DataTransfer', { vendorId: 'Eveys', messageId: 'ping' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('Accepted');
        sim.stop();
    });

    it('DataTransfer UnknownVendorId for foreign vendor', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('DataTransfer', { vendorId: 'OtherCorp' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('UnknownVendorId');
        sim.stop();
    });

    it('ClearCache Accepted', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('ClearCache', {});
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.result as { status: string }).status).toBe('Accepted');
        sim.stop();
    });

    it('TriggerMessage Accepted for known type, NotImplemented otherwise', async () => {
        const { sim } = newSim();
        const a = await sim.handleCsmsCall('TriggerMessage', { requestedMessage: 'Heartbeat' });
        expect(a.ok && (a.result as { status: string }).status).toBe('Accepted');
        const b = await sim.handleCsmsCall('TriggerMessage', { requestedMessage: 'FirmwareStatusNotification' });
        expect(b.ok && (b.result as { status: string }).status).toBe('NotImplemented');
        sim.stop();
    });

    it('Unknown action returns NotImplemented CALLERROR', async () => {
        const { sim } = newSim();
        const r = await sim.handleCsmsCall('SomeUnknownAction', {});
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.code).toBe('NotImplemented');
        sim.stop();
    });
});
