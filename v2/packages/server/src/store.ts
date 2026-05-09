import Database from 'better-sqlite3';
import type { AcWiring, DCBatteryProfile, Device, DeviceType, PhaseMode, Session } from '@ocpp-sim/core';

/**
 * SQLite-backed store. Single file, two tables. Schema is versioned
 * via `PRAGMA user_version` — on open we run any pending migration
 * steps, in order. New columns get added with `ALTER TABLE`; never
 * drop columns (SQLite < 3.35 doesn't support it cleanly anyway).
 */
export class Store {
    readonly db: Database.Database;

    constructor(path: string) {
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        migrate(this.db);
    }

    close(): void {
        this.db.close();
    }

    // ---- devices ----

    listDevices(): Device[] {
        const rows = this.db.prepare(`SELECT * FROM devices ORDER BY created_at`).all() as DeviceRow[];
        return rows.map(rowToDevice);
    }

    getDevice(id: string): Device | null {
        const row = this.db.prepare(`SELECT * FROM devices WHERE id = ?`).get(id) as DeviceRow | undefined;
        return row ? rowToDevice(row) : null;
    }

    insertDevice(d: Device): void {
        this.db
            .prepare(
                `INSERT INTO devices
                  (id, display_name, type, model, vendor, firmware_version, max_power_kw, ocpp_url,
                   phase_mode, ac_wiring, dc_profile, created_at)
                 VALUES (@id, @displayName, @type, @model, @vendor, @firmwareVersion, @maxPowerKw, @ocppUrl,
                         @phaseMode, @acWiring, @dcProfile, @createdAt)`,
            )
            .run({
                id: d.id,
                displayName: d.displayName,
                type: d.type,
                model: d.model,
                vendor: d.vendor,
                firmwareVersion: d.firmwareVersion,
                maxPowerKw: d.maxPowerKw,
                ocppUrl: d.ocppUrl,
                phaseMode: d.phaseMode,
                acWiring: d.acWiring ? JSON.stringify(d.acWiring) : null,
                dcProfile: d.dcProfile ? JSON.stringify(d.dcProfile) : null,
                createdAt: d.createdAt,
            });
    }

    updateDevice(
        id: string,
        patch: Partial<
            Pick<
                Device,
                | 'displayName'
                | 'vendor'
                | 'firmwareVersion'
                | 'maxPowerKw'
                | 'ocppUrl'
                | 'phaseMode'
                | 'acWiring'
                | 'dcProfile'
            >
        >,
    ): void {
        const sets: string[] = [];
        const params: Record<string, unknown> = { id };
        if (patch.displayName !== undefined) {
            sets.push('display_name = @displayName');
            params.displayName = patch.displayName;
        }
        if (patch.vendor !== undefined) {
            sets.push('vendor = @vendor');
            params.vendor = patch.vendor;
        }
        if (patch.firmwareVersion !== undefined) {
            sets.push('firmware_version = @firmwareVersion');
            params.firmwareVersion = patch.firmwareVersion;
        }
        if (patch.maxPowerKw !== undefined) {
            sets.push('max_power_kw = @maxPowerKw');
            params.maxPowerKw = patch.maxPowerKw;
        }
        if (patch.ocppUrl !== undefined) {
            sets.push('ocpp_url = @ocppUrl');
            params.ocppUrl = patch.ocppUrl;
        }
        if (patch.phaseMode !== undefined) {
            sets.push('phase_mode = @phaseMode');
            params.phaseMode = patch.phaseMode;
        }
        if (patch.acWiring !== undefined) {
            sets.push('ac_wiring = @acWiring');
            params.acWiring = patch.acWiring ? JSON.stringify(patch.acWiring) : null;
        }
        if (patch.dcProfile !== undefined) {
            sets.push('dc_profile = @dcProfile');
            params.dcProfile = patch.dcProfile ? JSON.stringify(patch.dcProfile) : null;
        }
        if (sets.length === 0) return;
        this.db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }

    deleteDevice(id: string): boolean {
        const r = this.db.prepare(`DELETE FROM devices WHERE id = ?`).run(id);
        return r.changes > 0;
    }

    // ---- sessions ----

    insertSession(s: Omit<Session, 'id'>): number {
        const r = this.db
            .prepare(
                `INSERT INTO sessions
                  (device_id, connector_id, transaction_id, id_tag, status,
                   started_at, ended_at, end_reason, energy_wh, peak_power_kw)
                 VALUES (@deviceId, @connectorId, @transactionId, @idTag, @status,
                         @startedAt, @endedAt, @endReason, @energyWh, @peakPowerKw)`,
            )
            .run({
                deviceId: s.deviceId,
                connectorId: s.connectorId,
                transactionId: s.transactionId,
                idTag: s.idTag,
                status: s.status,
                startedAt: s.startedAt,
                endedAt: s.endedAt,
                endReason: s.endReason,
                energyWh: s.energyWh,
                peakPowerKw: s.peakPowerKw,
            });
        return Number(r.lastInsertRowid);
    }

    endSession(args: {
        id: number;
        endedAt: string;
        endReason: string;
        energyWh: number;
        peakPowerKw: number;
    }): void {
        this.db
            .prepare(
                `UPDATE sessions
                 SET status = 'completed', ended_at = @endedAt, end_reason = @endReason,
                     energy_wh = @energyWh, peak_power_kw = @peakPowerKw
                 WHERE id = @id`,
            )
            .run(args);
    }

    listSessions(filter: {
        deviceId?: string;
        status?: Session['status'];
        idTag?: string;
        since?: string;
        until?: string;
        limit?: number;
        offset?: number;
    } = {}): Session[] {
        const { sql, params } = buildSessionWhere(filter);
        params.limit = filter.limit ?? 100;
        params.offset = filter.offset ?? 0;
        const rows = this.db
            .prepare(`SELECT * FROM sessions ${sql} ORDER BY started_at DESC LIMIT @limit OFFSET @offset`)
            .all(params) as SessionRow[];
        return rows.map(rowToSession);
    }

    /** Total count for the same filter — used by the UI for pagination. */
    countSessions(filter: {
        deviceId?: string;
        status?: Session['status'];
        idTag?: string;
        since?: string;
        until?: string;
    } = {}): number {
        const { sql, params } = buildSessionWhere(filter);
        const row = this.db.prepare(`SELECT COUNT(*) as n FROM sessions ${sql}`).get(params) as
            | { n: number }
            | undefined;
        return row?.n ?? 0;
    }

    abortOrphanedSessions(): number {
        const now = new Date().toISOString();
        const r = this.db
            .prepare(
                `UPDATE sessions SET status = 'aborted', ended_at = @now, end_reason = 'server_restart'
                 WHERE status = 'active'`,
            )
            .run({ now });
        return r.changes;
    }

    // ---- per-device OCPP configuration ----

    listConfig(deviceId: string): { key: string; value: string }[] {
        return this.db
            .prepare(`SELECT key, value FROM device_config WHERE device_id = ? ORDER BY key`)
            .all(deviceId) as { key: string; value: string }[];
    }

    getConfig(deviceId: string, key: string): string | null {
        const row = this.db
            .prepare(`SELECT value FROM device_config WHERE device_id = ? AND key = ?`)
            .get(deviceId, key) as { value: string } | undefined;
        return row?.value ?? null;
    }

    setConfig(deviceId: string, key: string, value: string): void {
        this.db
            .prepare(
                `INSERT INTO device_config (device_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(device_id, key) DO UPDATE SET value = excluded.value`,
            )
            .run(deviceId, key, value);
    }

    // ---- app-wide settings ----

    getSetting(key: string): string | null {
        const row = this.db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as
            | { value: string }
            | undefined;
        return row?.value ?? null;
    }

    setSetting(key: string, value: string): void {
        this.db
            .prepare(
                `INSERT INTO app_settings (key, value) VALUES (?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            )
            .run(key, value);
    }

    /**
     * Drop every row from every table, keeping the schema in place.
     * The destructive path: used by POST /api/settings/reset. The
     * caller must despawn every Simulator first (so no live writes
     * race the truncates) and respawn nothing — there's nothing to
     * spawn after this returns.
     */
    reset(): void {
        const tx = this.db.transaction(() => {
            this.db.exec(`
                DELETE FROM sessions;
                DELETE FROM device_config;
                DELETE FROM devices;
                DELETE FROM app_settings;
                DELETE FROM sqlite_sequence WHERE name IN ('sessions');
            `);
        });
        tx();
    }
}

interface DeviceRow {
    id: string;
    display_name: string;
    type: string;
    model: string;
    vendor: string;
    firmware_version: string;
    max_power_kw: number;
    ocpp_url: string;
    phase_mode: string;
    ac_wiring: string | null;
    dc_profile: string | null;
    created_at: string;
}

function rowToDevice(r: DeviceRow): Device {
    return {
        id: r.id,
        displayName: r.display_name,
        type: r.type as DeviceType,
        model: r.model,
        vendor: r.vendor,
        firmwareVersion: r.firmware_version,
        maxPowerKw: r.max_power_kw,
        ocppUrl: r.ocpp_url,
        phaseMode: r.phase_mode as PhaseMode,
        acWiring: r.ac_wiring ? (JSON.parse(r.ac_wiring) as AcWiring) : undefined,
        dcProfile: r.dc_profile ? (JSON.parse(r.dc_profile) as DCBatteryProfile) : undefined,
        createdAt: r.created_at,
    };
}

function buildSessionWhere(filter: {
    deviceId?: string;
    status?: Session['status'];
    idTag?: string;
    since?: string;
    until?: string;
}): { sql: string; params: Record<string, unknown> } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.deviceId) {
        where.push('device_id = @deviceId');
        params.deviceId = filter.deviceId;
    }
    if (filter.status) {
        where.push('status = @status');
        params.status = filter.status;
    }
    if (filter.idTag) {
        where.push('id_tag LIKE @idTag');
        params.idTag = `%${filter.idTag}%`;
    }
    if (filter.since) {
        where.push('started_at >= @since');
        params.since = filter.since;
    }
    if (filter.until) {
        where.push('started_at <= @until');
        params.until = filter.until;
    }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

interface SessionRow {
    id: number;
    device_id: string;
    connector_id: number;
    transaction_id: number;
    id_tag: string;
    status: string;
    started_at: string;
    ended_at: string | null;
    end_reason: string | null;
    energy_wh: number;
    peak_power_kw: number;
}

function rowToSession(r: SessionRow): Session {
    return {
        id: r.id,
        deviceId: r.device_id,
        connectorId: r.connector_id,
        transactionId: r.transaction_id,
        idTag: r.id_tag,
        status: r.status as Session['status'],
        startedAt: r.started_at,
        endedAt: r.ended_at,
        endReason: r.end_reason,
        energyWh: r.energy_wh,
        peakPowerKw: r.peak_power_kw,
    };
}

const MIGRATIONS: ((db: Database.Database) => void)[] = [
    // v1 — initial schema
    (db) => {
        db.exec(`
            CREATE TABLE devices (
                id                TEXT PRIMARY KEY,
                display_name      TEXT NOT NULL,
                type              TEXT NOT NULL CHECK(type IN ('AC','DC')),
                model             TEXT NOT NULL,
                vendor            TEXT NOT NULL DEFAULT 'Eveys',
                firmware_version  TEXT NOT NULL DEFAULT '1.0.0',
                max_power_kw      REAL NOT NULL,
                ocpp_url          TEXT NOT NULL,
                phase_mode        TEXT NOT NULL DEFAULT 'balanced',
                dc_profile        TEXT,
                created_at        TEXT NOT NULL
            );
            CREATE TABLE sessions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                connector_id    INTEGER NOT NULL,
                transaction_id  INTEGER NOT NULL,
                id_tag          TEXT NOT NULL,
                status          TEXT NOT NULL CHECK(status IN ('active','completed','aborted')),
                started_at      TEXT NOT NULL,
                ended_at        TEXT,
                end_reason      TEXT,
                energy_wh       REAL NOT NULL DEFAULT 0,
                peak_power_kw   REAL NOT NULL DEFAULT 0
            );
            CREATE INDEX sessions_device ON sessions(device_id);
            CREATE INDEX sessions_status ON sessions(status);
        `);
    },
    // v2 — per-device OCPP configuration store
    (db) => {
        db.exec(`
            CREATE TABLE device_config (
                device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                key        TEXT NOT NULL,
                value      TEXT NOT NULL,
                PRIMARY KEY (device_id, key)
            );
        `);
    },
    // v3 — single-row app-wide settings (default ocpp url, etc.)
    (db) => {
        db.exec(`
            CREATE TABLE app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    },
    // v4 — per-device AC wiring (phases, nominal/line-to-line voltage,
    // line-to-line reporting flag). Stored as JSON for the same reason
    // as dc_profile: small, optional, easier to evolve than columns.
    (db) => {
        db.exec(`ALTER TABLE devices ADD COLUMN ac_wiring TEXT`);
    },
];

function migrate(db: Database.Database): void {
    const current = (db.pragma('user_version', { simple: true }) as number) ?? 0;
    for (let v = current; v < MIGRATIONS.length; v++) {
        const step = MIGRATIONS[v];
        if (!step) continue;
        db.transaction(() => {
            step(db);
            db.pragma(`user_version = ${v + 1}`);
        })();
    }
}
