import { describe, expect, it } from 'vitest';
import type { Device } from '@ocpp-sim/core';
import { OcppConfig } from './ocpp-config.js';
import { Store } from './store.js';

const sample: Device = {
    id: 'cp_cfg_test',
    displayName: 'Cfg Test',
    type: 'AC',
    model: 'Eveys-22kW-AC',
    vendor: 'Eveys',
    firmwareVersion: '1.0.0',
    maxPowerKw: 22,
    ocppUrl: 'ws://localhost:19000',
    phaseMode: 'balanced',
    createdAt: '2026-05-09T12:00:00.000Z',
};

const setup = () => {
    const store = new Store(':memory:');
    store.insertDevice(sample);
    return new OcppConfig(store, sample.id, 1);
};

describe('OcppConfig', () => {
    it('seeds defaults on first construction', () => {
        const cfg = setup();
        expect(cfg.get('HeartbeatInterval')).toBe('60');
        expect(cfg.get('MeterValueSampleInterval')).toBe('60');
        expect(cfg.get('NumberOfConnectors')).toBe('1');
    });

    it('honors numberOfConnectors override (DC has 2)', () => {
        const store = new Store(':memory:');
        store.insertDevice({ ...sample, id: 'cp_dc', type: 'DC' });
        const cfg = new OcppConfig(store, 'cp_dc', 2);
        expect(cfg.get('NumberOfConnectors')).toBe('2');
    });

    it('set Accepted on a writable int key with a valid value', () => {
        const cfg = setup();
        const status = cfg.set('HeartbeatInterval', '60');
        expect(status).toBe('Accepted');
        expect(cfg.get('HeartbeatInterval')).toBe('60');
    });

    it('set Rejected on a readonly key', () => {
        const cfg = setup();
        const status = cfg.set('NumberOfConnectors', '5');
        expect(status).toBe('Rejected');
        expect(cfg.get('NumberOfConnectors')).toBe('1'); // unchanged
    });

    it('set Rejected on a non-int value to an int key', () => {
        const cfg = setup();
        expect(cfg.set('HeartbeatInterval', 'not-a-number')).toBe('Rejected');
    });

    it('set Rejected on a non-bool value to a bool key', () => {
        const cfg = setup();
        expect(cfg.set('AuthorizeRemoteTxRequests', 'maybe')).toBe('Rejected');
    });

    it('set NotSupported on an unknown key', () => {
        const cfg = setup();
        expect(cfg.set('VendorMagicKey', '1')).toBe('NotSupported');
    });

    it('getMany returns all keys when keys list is empty/undefined', () => {
        const cfg = setup();
        const r = cfg.getMany(undefined);
        expect(r.configurationKey.length).toBeGreaterThan(20);
        expect(r.unknownKey).toEqual([]);
    });

    it('getMany splits known + unknown keys', () => {
        const cfg = setup();
        const r = cfg.getMany(['HeartbeatInterval', 'BogusKey']);
        expect(r.configurationKey).toHaveLength(1);
        expect(r.configurationKey[0]?.key).toBe('HeartbeatInterval');
        expect(r.unknownKey).toEqual(['BogusKey']);
    });

    it('onChange fires for accepted writes only', () => {
        const cfg = setup();
        const seen: [string, string][] = [];
        cfg.onChange((k, v) => seen.push([k, v]));
        cfg.set('HeartbeatInterval', '120');
        cfg.set('NumberOfConnectors', '99'); // readonly → no fire
        cfg.set('NotARealKey', 'x'); // unknown → no fire
        expect(seen).toEqual([['HeartbeatInterval', '120']]);
    });

    it('values persist across OcppConfig instances on the same store', () => {
        const store = new Store(':memory:');
        store.insertDevice(sample);
        const cfg1 = new OcppConfig(store, sample.id, 1);
        cfg1.set('HeartbeatInterval', '45');

        const cfg2 = new OcppConfig(store, sample.id, 1);
        expect(cfg2.get('HeartbeatInterval')).toBe('45');
    });
});
