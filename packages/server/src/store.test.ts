import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

    describe('reopen on a real file', () => {
        let dir: string;
        let path: string;
        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'ocpp-sim-store-'));
            path = join(dir, 'sim.sqlite');
        });
        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        it('rows inserted before close survive a re-open at the same version', () => {
            const s1 = new Store(path);
            const v1 = s1.db.pragma('user_version', { simple: true });
            s1.insertDevice(sample);
            s1.close();

            const s2 = new Store(path);
            const v2 = s2.db.pragma('user_version', { simple: true });
            expect(v2).toBe(v1);
            const d = s2.getDevice(sample.id);
            expect(d?.id).toBe(sample.id);
            // Columns added by the most recent migrations should be
            // present and default to undefined / null on a row created
            // by an older code path. authPassword (v7) and a
            // not-yet-soft-deleted device should round-trip cleanly.
            expect(d?.authPassword).toBeUndefined();
            s2.close();
        });

        it('re-running every migration on a populated DB is a no-op (idempotent)', () => {
            const s1 = new Store(path);
            s1.insertDevice(sample);
            const sessionRowId = s1.insertSession({
                deviceId: sample.id,
                connectorId: 1,
                transactionId: 1,
                idTag: 'TAG',
                status: 'completed',
                startedAt: '2026-05-09T12:00:00.000Z',
                endedAt: '2026-05-09T12:30:00.000Z',
                endReason: 'Local',
                energyWh: 1000,
                peakPowerKw: 5,
            });
            // Force the migration runner to re-evaluate every step by
            // clearing user_version. Each CREATE/ALTER must be guarded
            // (`IF NOT EXISTS` + addColumnIfMissing) so this is a no-op
            // — that's what makes a future "rebuild schema" / replay
            // path safe to ship.
            s1.db.pragma('user_version = 0');
            s1.close();

            const s2 = new Store(path);
            // Migrations ran cleanly; rows survive untouched.
            expect(s2.getDevice(sample.id)?.id).toBe(sample.id);
            const sessions = s2.listSessions({ deviceId: sample.id });
            expect(sessions).toHaveLength(1);
            expect(sessions[0]?.id).toBe(sessionRowId);
            // user_version returned to the latest after replay.
            expect(s2.db.pragma('user_version', { simple: true })).toBe(12);
            s2.close();
        });
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

    it('updates each editable field', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        s.updateDevice(sample.id, {
            displayName: 'New name',
            vendor: 'NewVendor',
            firmwareVersion: '2.0.0',
            maxPowerKw: 11,
            ocppUrl: 'ws://other.example:9000',
            phaseMode: 'single-phase',
            dcProfile: {
                capacityKwh: 75,
                chargerMaxKw: 150,
                nominalVoltageV: 800,
                initialSocPct: 10,
                targetSocPct: 90,
                rampUpSeconds: 5,
            },
        });
        const d = s.getDevice(sample.id);
        expect(d?.displayName).toBe('New name');
        expect(d?.vendor).toBe('NewVendor');
        expect(d?.firmwareVersion).toBe('2.0.0');
        expect(d?.maxPowerKw).toBe(11);
        expect(d?.ocppUrl).toBe('ws://other.example:9000');
        expect(d?.phaseMode).toBe('single-phase');
        expect(d?.dcProfile?.capacityKwh).toBe(75);
        expect(d?.type).toBe('AC'); // type still locked
        s.close();
    });

    it('roundtrips an AC wiring config', () => {
        const s = new Store(':memory:');
        s.insertDevice({
            ...sample,
            acWiring: {
                phases: 1,
                nominalVoltageV: 240,
                lineToLineV: 415,
                reportLineToLine: false,
            },
        });
        const d = s.getDevice(sample.id);
        expect(d?.acWiring).toEqual({
            phases: 1,
            nominalVoltageV: 240,
            lineToLineV: 415,
            reportLineToLine: false,
        });
        s.close();
    });

    it('updateDevice patches acWiring', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        s.updateDevice(sample.id, {
            acWiring: { phases: 3, nominalVoltageV: 230, lineToLineV: 400, reportLineToLine: true },
        });
        expect(s.getDevice(sample.id)?.acWiring?.reportLineToLine).toBe(true);
        s.close();
    });

    it('updates a single field without touching the rest', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        s.updateDevice(sample.id, { ocppUrl: 'ws://elsewhere:1234' });
        const d = s.getDevice(sample.id);
        expect(d?.ocppUrl).toBe('ws://elsewhere:1234');
        expect(d?.vendor).toBe(sample.vendor);
        expect(d?.maxPowerKw).toBe(sample.maxPowerKw);
        s.close();
    });

    it('soft-delete hides the device but preserves session history', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        const sessionRowId = s.insertSession({
            deviceId: sample.id,
            connectorId: 1,
            transactionId: 42,
            idTag: 'TAG',
            status: 'completed',
            startedAt: '2026-05-09T12:00:00.000Z',
            endedAt: '2026-05-09T12:30:00.000Z',
            endReason: 'Local',
            energyWh: 1234,
            peakPowerKw: 7.4,
        });
        expect(sessionRowId).toBeGreaterThan(0);

        const removed = s.deleteDevice(sample.id);
        expect(removed).toBe(true);

        // Hidden from listings + lookups.
        expect(s.listDevices()).toEqual([]);
        expect(s.getDevice(sample.id)).toBeNull();

        // But the historical session still resolves — the FK target
        // exists, just with deleted_at set. Audit trails matter.
        const sessions = s.listSessions({ deviceId: sample.id });
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.id).toBe(sessionRowId);
        s.close();
    });

    it('deleteDevice returns false when called twice', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        expect(s.deleteDevice(sample.id)).toBe(true);
        expect(s.deleteDevice(sample.id)).toBe(false);
        s.close();
    });

    it('listDeletedDevices returns soft-deleted rows newest first with deletedAt', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        s.insertDevice({ ...sample, id: 'cp_other', createdAt: '2026-05-09T12:00:00.000Z' });
        s.deleteDevice(sample.id);
        // Ensure deleted_at differs by at least 1ms so the ORDER BY
        // is deterministic; sqlite stores ISO-8601 strings literally.
        s.db
            .prepare(`UPDATE devices SET deleted_at = ? WHERE id = ?`)
            .run('2026-05-10T01:00:00.000Z', sample.id);
        s.deleteDevice('cp_other');
        s.db
            .prepare(`UPDATE devices SET deleted_at = ? WHERE id = ?`)
            .run('2026-05-10T02:00:00.000Z', 'cp_other');
        const list = s.listDeletedDevices();
        expect(list).toHaveLength(2);
        expect(list[0]?.id).toBe('cp_other'); // newest deletion first
        expect(list[0]?.deletedAt).toBe('2026-05-10T02:00:00.000Z');
        expect(list[1]?.id).toBe(sample.id);
        s.close();
    });

    it('restoreDevice un-soft-deletes and returns the row', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        s.deleteDevice(sample.id);
        expect(s.getDevice(sample.id)).toBeNull();

        const restored = s.restoreDevice(sample.id);
        expect(restored?.id).toBe(sample.id);
        expect(s.getDevice(sample.id)?.id).toBe(sample.id);
        // Subsequent restore on a live row is a no-op.
        expect(s.restoreDevice(sample.id)).toBeNull();
        s.close();
    });

    it('restoreDevice returns null for an unknown id', () => {
        const s = new Store(':memory:');
        expect(s.restoreDevice('nope')).toBeNull();
        s.close();
    });

    it('purgeDevice hard-deletes and cascades sessions', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        const sessionRowId = s.insertSession({
            deviceId: sample.id,
            connectorId: 1,
            transactionId: 1,
            idTag: 'TAG',
            status: 'completed',
            startedAt: '2026-05-09T12:00:00.000Z',
            endedAt: '2026-05-09T12:30:00.000Z',
            endReason: 'Local',
            energyWh: 100,
            peakPowerKw: 5,
        });
        s.deleteDevice(sample.id);
        // Session still exists after soft-delete.
        expect(s.listSessions({ deviceId: sample.id })).toHaveLength(1);

        expect(s.purgeDevice(sample.id)).toBe(true);
        // Both the device row and its session are gone — the FK
        // CASCADE took the audit trail with it. That's the entire
        // point of the purge path.
        expect(s.listDeletedDevices()).toEqual([]);
        expect(s.listSessions({ deviceId: sample.id })).toEqual([]);
        // Idempotent on the now-empty row.
        expect(s.purgeDevice(sample.id)).toBe(false);
        // Silence the unused warning.
        expect(sessionRowId).toBeGreaterThan(0);
        s.close();
    });

    it('purgeDevice refuses to drop a live device (must soft-delete first)', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        // Not soft-deleted yet → purge is a no-op.
        expect(s.purgeDevice(sample.id)).toBe(false);
        expect(s.getDevice(sample.id)?.id).toBe(sample.id);
        s.close();
    });
});

describe('Store — app settings', () => {
    it('returns null for an unset key', () => {
        const s = new Store(':memory:');
        expect(s.getSetting('default_ocpp_url')).toBeNull();
        s.close();
    });

    it('roundtrips a setting', () => {
        const s = new Store(':memory:');
        s.setSetting('default_ocpp_url', 'ws://gateway.example:19000');
        expect(s.getSetting('default_ocpp_url')).toBe('ws://gateway.example:19000');
        s.close();
    });

    it('upserts on conflict', () => {
        const s = new Store(':memory:');
        s.setSetting('default_ocpp_url', 'ws://a:1');
        s.setSetting('default_ocpp_url', 'ws://b:2');
        expect(s.getSetting('default_ocpp_url')).toBe('ws://b:2');
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
        s.endSession({
            id,
            endedAt: '2026-05-09T12:30:00.000Z',
            endReason: 'Local',
            energyWh: 5000,
            peakPowerKw: 10,
        });
        const completed = s.listSessions({ status: 'completed' });
        expect(completed).toHaveLength(1);
        expect(completed[0]?.energyWh).toBe(5000);
        s.close();
    });

    it('abortOrphanedBenchmarkSessions only touches bench_* devices', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        s.insertDevice({ ...sample, id: 'bench_foo' });
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
        s.insertSession({
            deviceId: 'bench_foo',
            connectorId: 1,
            transactionId: 2,
            idTag: 'T',
            status: 'active',
            startedAt: '2026-05-09T12:00:00.000Z',
            endedAt: null,
            endReason: null,
            energyWh: 0,
            peakPowerKw: 0,
        });
        const n = s.abortOrphanedBenchmarkSessions();
        expect(n).toBe(1);
        // Real-device session must survive — it'll be resumed by the
        // Simulator constructor on next boot.
        expect(s.listSessions({ deviceId: sample.id, status: 'active' })).toHaveLength(1);
        expect(s.listSessions({ deviceId: 'bench_foo', status: 'aborted' })).toHaveLength(1);
        s.close();
    });
});

describe('Store — pending messages (offline queue)', () => {
    it('bumpPendingAttempts increments and persists across reads', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        const id = s.enqueuePendingMessage(sample.id, 'MeterValues', { foo: 1 });
        expect(s.listPendingMessages(sample.id)[0]?.attempts).toBe(0);
        expect(s.bumpPendingAttempts(id)).toBe(1);
        expect(s.bumpPendingAttempts(id)).toBe(2);
        // The counter persists — listing after the bumps reflects it,
        // which is what makes the drain budget span reconnects.
        expect(s.listPendingMessages(sample.id)[0]?.attempts).toBe(2);
        s.close();
    });

    it('localTxId is preserved and rebinds rewrite transactionId in place', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        const localTx = -42;
        const startId = s.enqueuePendingMessage(
            sample.id,
            'StartTransaction',
            { connectorId: 1, idTag: 'T', meterStart: 0 },
            localTx,
        );
        s.enqueuePendingMessage(
            sample.id,
            'MeterValues',
            { connectorId: 1, transactionId: localTx, meterValue: [] },
            localTx,
        );
        s.enqueuePendingMessage(
            sample.id,
            'StopTransaction',
            { transactionId: localTx, meterStop: 0, reason: 'Local', timestamp: 'x' },
            localTx,
        );
        s.rebindPendingTxId(sample.id, localTx, 9001);
        const rows = s.listPendingMessages(sample.id);
        // StartTransaction has no transactionId in its payload — rebind
        // only touches rows that did, and clears local_tx_id on those.
        const mv = rows.find((r) => r.action === 'MeterValues');
        const stop = rows.find((r) => r.action === 'StopTransaction');
        expect((mv?.payload as { transactionId: number }).transactionId).toBe(9001);
        expect((stop?.payload as { transactionId: number }).transactionId).toBe(9001);
        expect(mv?.localTxId).toBeNull();
        expect(stop?.localTxId).toBeNull();
        // Start row itself was rebound (no transactionId field) and its
        // localTxId cleared too.
        const start = rows.find((r) => r.id === startId);
        expect(start?.localTxId).toBeNull();
        s.close();
    });

    it('trimPendingMessages drops oldest MeterValues but never Start/Stop', () => {
        const s = new Store(':memory:');
        s.insertDevice(sample);
        s.enqueuePendingMessage(sample.id, 'StartTransaction', {});
        for (let i = 0; i < 5; i++) s.enqueuePendingMessage(sample.id, 'MeterValues', { i });
        s.enqueuePendingMessage(sample.id, 'StopTransaction', {});
        // 7 rows total. Trim to 4 — must drop 3 oldest MeterValues, keep
        // Start + Stop + 2 newest MeterValues.
        const dropped = s.trimPendingMessages(sample.id, 4);
        expect(dropped).toBe(3);
        const rows = s.listPendingMessages(sample.id);
        expect(rows.map((r) => r.action)).toEqual([
            'StartTransaction',
            'MeterValues',
            'MeterValues',
            'StopTransaction',
        ]);
        s.close();
    });
});
