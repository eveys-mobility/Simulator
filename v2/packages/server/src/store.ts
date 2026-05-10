import Database from 'better-sqlite3';
import type {
    AcWiring,
    BenchmarkRun,
    BenchmarkRunSummary,
    ChargingProfile,
    ChargingProfilePurpose,
    DCBatteryProfile,
    Device,
    DeviceType,
    PhaseMode,
    Scenario,
    ScenarioStatus,
    Session,
} from '@ocpp-sim/core';

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
        // Soft-deleted rows stay in the table so historical sessions
        // keep their FK target — but they don't show up in any list.
        const rows = this.db
            .prepare(`SELECT * FROM devices WHERE deleted_at IS NULL ORDER BY created_at`)
            .all() as DeviceRow[];
        return rows.map(rowToDevice);
    }

    getDevice(id: string): Device | null {
        const row = this.db
            .prepare(`SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL`)
            .get(id) as DeviceRow | undefined;
        return row ? rowToDevice(row) : null;
    }

    insertDevice(d: Device): void {
        this.db
            .prepare(
                `INSERT INTO devices
                  (id, display_name, type, model, vendor, firmware_version, max_power_kw, ocpp_url,
                   auth_password, phase_mode, ac_wiring, dc_profile, created_at)
                 VALUES (@id, @displayName, @type, @model, @vendor, @firmwareVersion, @maxPowerKw, @ocppUrl,
                         @authPassword, @phaseMode, @acWiring, @dcProfile, @createdAt)`,
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
                authPassword: d.authPassword ?? null,
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
                | 'authPassword'
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
        if (patch.authPassword !== undefined) {
            sets.push('auth_password = @authPassword');
            // Empty string clears the password (anonymous mode); the
            // schema lets the column be NULL.
            params.authPassword = patch.authPassword === '' ? null : patch.authPassword;
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
        // Soft delete. Sessions and config rows have FK ON DELETE CASCADE,
        // which would wipe the audit trail if we hard-deleted; the
        // soft path keeps history intact and is reversible — see
        // restoreDevice / purgeDevice.
        const r = this.db
            .prepare(`UPDATE devices SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
            .run(new Date().toISOString(), id);
        return r.changes > 0;
    }

    /**
     * Soft-deleted rows that operators can still see (and restore /
     * permanently purge) from the Settings page. Ordered by deletion
     * time, newest first — that's what an operator hunting for "the
     * one I just deleted" wants.
     */
    listDeletedDevices(): (Device & { deletedAt: string })[] {
        const rows = this.db
            .prepare(`SELECT * FROM devices WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
            .all() as DeviceRow[];
        return rows.map((r) => ({
            ...rowToDevice(r),
            // Non-null asserted: WHERE clause guarantees deleted_at is set.
            deletedAt: r.deleted_at as string,
        }));
    }

    /** Reverses deleteDevice. Returns the device row if it existed and
     *  was deleted, null otherwise. The caller is responsible for
     *  re-spawning the simulator. */
    restoreDevice(id: string): Device | null {
        const r = this.db
            .prepare(`UPDATE devices SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`)
            .run(id);
        if (r.changes === 0) return null;
        return this.getDevice(id);
    }

    /** Hard-delete: drops the device row, which cascades through every
     *  FK (sessions, device_config, charging_profiles). Use only after
     *  the operator has explicitly confirmed they want to lose history.
     *  No-op if the device isn't in the soft-deleted state. */
    purgeDevice(id: string): boolean {
        const r = this.db
            .prepare(`DELETE FROM devices WHERE id = ? AND deleted_at IS NOT NULL`)
            .run(id);
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

    // ---- charging profiles (Smart Charging) ----

    /**
     * Insert or replace a profile by (device, connector, purpose,
     * stackLevel). Per OCPP §3.13 a same-key write replaces the
     * existing one — the CSMS uses this to evolve a stack.
     */
    setChargingProfile(deviceId: string, connectorId: number, profile: ChargingProfile): void {
        this.db
            .prepare(
                `INSERT INTO charging_profiles
                   (device_id, connector_id, profile_id, stack_level, purpose, profile_json)
                 VALUES (@deviceId, @connectorId, @profileId, @stackLevel, @purpose, @json)
                 ON CONFLICT(device_id, connector_id, purpose, stack_level)
                 DO UPDATE SET profile_id = excluded.profile_id, profile_json = excluded.profile_json`,
            )
            .run({
                deviceId,
                connectorId,
                profileId: profile.chargingProfileId,
                stackLevel: profile.stackLevel,
                purpose: profile.chargingProfilePurpose,
                json: JSON.stringify(profile),
            });
    }

    /**
     * Filtered delete used by ClearChargingProfile. All filter fields
     * are optional; an empty filter clears every profile on the device.
     * Returns the number of rows removed.
     */
    clearChargingProfiles(deviceId: string, filter: {
        id?: number;
        connectorId?: number;
        purpose?: ChargingProfilePurpose;
        stackLevel?: number;
    }): number {
        const where = ['device_id = @deviceId'];
        const params: Record<string, unknown> = { deviceId };
        if (filter.id !== undefined) {
            where.push('profile_id = @id');
            params.id = filter.id;
        }
        if (filter.connectorId !== undefined) {
            where.push('connector_id = @connectorId');
            params.connectorId = filter.connectorId;
        }
        if (filter.purpose !== undefined) {
            where.push('purpose = @purpose');
            params.purpose = filter.purpose;
        }
        if (filter.stackLevel !== undefined) {
            where.push('stack_level = @stackLevel');
            params.stackLevel = filter.stackLevel;
        }
        const r = this.db
            .prepare(`DELETE FROM charging_profiles WHERE ${where.join(' AND ')}`)
            .run(params);
        return r.changes;
    }

    listChargingProfiles(deviceId: string, connectorId?: number): {
        connectorId: number;
        profile: ChargingProfile;
    }[] {
        const sql = connectorId !== undefined
            ? `SELECT connector_id, profile_json FROM charging_profiles WHERE device_id = ? AND connector_id = ?`
            : `SELECT connector_id, profile_json FROM charging_profiles WHERE device_id = ?`;
        const rows = (
            connectorId !== undefined
                ? this.db.prepare(sql).all(deviceId, connectorId)
                : this.db.prepare(sql).all(deviceId)
        ) as Array<{ connector_id: number; profile_json: string }>;
        return rows.map((r) => ({
            connectorId: r.connector_id,
            profile: JSON.parse(r.profile_json) as ChargingProfile,
        }));
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

    // ---- benchmark runs ----

    insertBenchmarkRun(scenario: Scenario, startedAt: string): number {
        const r = this.db
            .prepare(
                `INSERT INTO benchmark_runs (scenario, status, started_at)
                 VALUES (?, 'running', ?)`,
            )
            .run(JSON.stringify(scenario), startedAt);
        return Number(r.lastInsertRowid);
    }

    endBenchmarkRun(args: {
        id: number;
        status: ScenarioStatus;
        endedAt: string;
        summary: BenchmarkRunSummary;
    }): void {
        this.db
            .prepare(
                `UPDATE benchmark_runs
                 SET status = @status, ended_at = @endedAt, summary = @summary
                 WHERE id = @id`,
            )
            .run({
                id: args.id,
                status: args.status,
                endedAt: args.endedAt,
                summary: JSON.stringify(args.summary),
            });
    }

    listBenchmarkRuns(args: { limit?: number; offset?: number } = {}): { runs: BenchmarkRun[]; total: number } {
        const limit = Math.max(1, Math.min(200, args.limit ?? 50));
        const offset = Math.max(0, args.offset ?? 0);
        const rows = this.db
            .prepare(`SELECT * FROM benchmark_runs ORDER BY started_at DESC LIMIT ? OFFSET ?`)
            .all(limit, offset) as BenchmarkRunRow[];
        const total = (this.db.prepare(`SELECT COUNT(*) as n FROM benchmark_runs`).get() as { n: number }).n;
        return { runs: rows.map(rowToBenchmarkRun), total };
    }

    getBenchmarkRun(id: number): BenchmarkRun | null {
        const row = this.db.prepare(`SELECT * FROM benchmark_runs WHERE id = ?`).get(id) as
            | BenchmarkRunRow
            | undefined;
        return row ? rowToBenchmarkRun(row) : null;
    }

    /** Mark every still-running run as failed. Used at boot so a
     *  crashed run doesn't show as "running" forever. */
    failOrphanedBenchmarkRuns(): number {
        const now = new Date().toISOString();
        const r = this.db
            .prepare(
                `UPDATE benchmark_runs SET status = 'failed', ended_at = COALESCE(ended_at, ?)
                 WHERE status = 'running'`,
            )
            .run(now);
        return r.changes;
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
                DELETE FROM charging_profiles;
                DELETE FROM devices;
                DELETE FROM app_settings;
                DELETE FROM benchmark_runs;
                DELETE FROM sqlite_sequence WHERE name IN ('sessions','benchmark_runs','charging_profiles');
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
    auth_password: string | null;
    phase_mode: string;
    ac_wiring: string | null;
    dc_profile: string | null;
    created_at: string;
    deleted_at: string | null;
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
        authPassword: r.auth_password ?? undefined,
        phaseMode: r.phase_mode as PhaseMode,
        acWiring: r.ac_wiring ? (JSON.parse(r.ac_wiring) as AcWiring) : undefined,
        dcProfile: r.dc_profile ? (JSON.parse(r.dc_profile) as DCBatteryProfile) : undefined,
        createdAt: r.created_at,
    };
}

interface BenchmarkRunRow {
    id: number;
    scenario: string;
    status: string;
    started_at: string;
    ended_at: string | null;
    summary: string | null;
}

function rowToBenchmarkRun(r: BenchmarkRunRow): BenchmarkRun {
    return {
        id: r.id,
        scenario: JSON.parse(r.scenario) as Scenario,
        status: r.status as ScenarioStatus,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        summary: r.summary ? (JSON.parse(r.summary) as BenchmarkRunSummary) : null,
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
    // v5 — benchmark runs (Phase 7b). One row per scenario invocation.
    // Scenario + summary stored as JSON because both shapes evolve.
    (db) => {
        db.exec(`
            CREATE TABLE benchmark_runs (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario     TEXT NOT NULL,
                status       TEXT NOT NULL CHECK(status IN ('running','completed','stopped','failed')),
                started_at   TEXT NOT NULL,
                ended_at     TEXT,
                summary      TEXT
            );
            CREATE INDEX benchmark_runs_status ON benchmark_runs(status);
        `);
    },
    // v6 — charging profiles (Phase 8). One row per (device, connector,
    // purpose, stack_level). The CSMS-supplied profile id is in the
    // JSON payload; we use it for ClearChargingProfile filtering but
    // it isn't a primary key (CSMS may reuse ids across devices).
    (db) => {
        db.exec(`
            CREATE TABLE charging_profiles (
                row_id       INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                connector_id INTEGER NOT NULL,
                profile_id   INTEGER NOT NULL,
                stack_level  INTEGER NOT NULL,
                purpose      TEXT NOT NULL CHECK(purpose IN ('ChargePointMaxProfile','TxDefaultProfile','TxProfile')),
                profile_json TEXT NOT NULL,
                UNIQUE(device_id, connector_id, purpose, stack_level)
            );
            CREATE INDEX charging_profiles_device ON charging_profiles(device_id);
        `);
    },
    // v7 — OCPP basic-auth password per device (§17.4). Stored in plain
    // text on purpose: this is a dev/test simulator and the secret is
    // already on the wire as Basic auth. Real production credentials
    // should be injected at deploy time, not stored in this DB.
    (db) => {
        db.exec(`ALTER TABLE devices ADD COLUMN auth_password TEXT`);
    },
    // v8 — soft-delete column. Hard-deleting a device used to cascade
    // through the FK and drop every session row, wiping audit history.
    // We now mark deleted_at instead and filter on read; the device's
    // simulator is despawned, but the rows stick around for /sessions.
    (db) => {
        db.exec(`ALTER TABLE devices ADD COLUMN deleted_at TEXT`);
        db.exec(`CREATE INDEX devices_deleted_at ON devices(deleted_at)`);
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
