/**
 * SQLite snapshot layer for the fleet manager.
 *
 * Persisted: groups, charge_points, sessions (lifecycle records, not
 * tick-level meter values). Runtime state lives in the in-memory
 * Registry; SQLite is reloaded only on boot to re-spawn workers.
 *
 * Schema migration is idempotent — `CREATE TABLE IF NOT EXISTS` and
 * `CREATE INDEX IF NOT EXISTS` everywhere — so opening a db file
 * created by an older fleet version doesn't crash; it just gets
 * back-filled with whatever's missing. v2 columns will be added
 * with `PRAGMA user_version` checks (out of scope here).
 */

import Database, { Database as DatabaseType, Statement } from 'better-sqlite3';
import * as path from 'node:path';
import { CPType, PhaseMode, DCBatteryProfile } from './protocol';

export type LbStrategy = 'round_robin' | 'least_active';
export type SessionStatus = 'active' | 'completed' | 'aborted';

export interface GroupRow {
    id: number;
    name: string;
    type: CPType;
    lb_strategy: LbStrategy;
    lb_enabled: number;          // SQLite stores BOOLEAN as INTEGER 0/1
    lb_round_robin_cursor: number; // monotonic count of round_robin picks
    created_at: string;
}

export interface CPRow {
    id: number;
    cp_id: string;
    display_name: string;
    type: CPType;
    group_id: number | null;
    phase_mode: string | null;          // serialised PhaseMode for AC
    dc_profile: string | null;          // JSON for DC
    max_power_kw: number | null;
    ocpp_url: string | null;
    created_at: string;
}

export interface SessionRow {
    id: number;
    cp_id: string;
    connector_id: number;
    id_tag: string;
    status: SessionStatus;
    started_at: string;
    ended_at: string | null;
    end_reason: string | null;
    energy_wh: number;
    peak_power_kw: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT NOT NULL UNIQUE,
    type                  TEXT NOT NULL CHECK (type IN ('AC', 'DC')),
    lb_strategy           TEXT NOT NULL DEFAULT 'round_robin' CHECK (lb_strategy IN ('round_robin', 'least_active')),
    lb_enabled            INTEGER NOT NULL DEFAULT 1,
    lb_round_robin_cursor INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS charge_points (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    cp_id        TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('AC', 'DC')),
    group_id     INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    phase_mode   TEXT,
    dc_profile   TEXT,
    max_power_kw REAL,
    ocpp_url     TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_charge_points_group ON charge_points(group_id);

CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    cp_id         TEXT NOT NULL,
    connector_id  INTEGER NOT NULL,
    id_tag        TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('active', 'completed', 'aborted')),
    started_at    TEXT NOT NULL,
    ended_at      TEXT,
    end_reason    TEXT,
    energy_wh     INTEGER NOT NULL DEFAULT 0,
    peak_power_kw REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_cp ON sessions(cp_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
`;

export class FleetStore {
    public readonly db: DatabaseType;

    private readonly groupInsert: Statement;
    private readonly groupUpdate: Statement;
    private readonly groupDelete: Statement;
    private readonly groupSelectAll: Statement;
    private readonly groupSelectById: Statement;
    private readonly groupSelectByName: Statement;

    private readonly cpInsert: Statement;
    private readonly cpUpdate: Statement;
    private readonly cpDelete: Statement;
    private readonly cpSelectAll: Statement;
    private readonly cpSelectById: Statement;

    private readonly sessionInsert: Statement;
    private readonly sessionEnd: Statement;
    private readonly sessionSelectByStatus: Statement;
    private readonly sessionSelectAll: Statement;
    private readonly sessionSelectByCP: Statement;
    private readonly sessionAbortAllActive: Statement;

    constructor(filename: string | ':memory:') {
        const target = filename === ':memory:'
            ? filename
            : path.resolve(filename);
        this.db = new Database(target);
        // Foreign keys are off by default for legacy reasons; we want
        // ON DELETE SET NULL on cp.group_id to actually fire.
        this.db.pragma('foreign_keys = ON');
        this.db.exec(SCHEMA);
        this.migrate();

        this.groupInsert = this.db.prepare(`
            INSERT INTO groups (name, type, lb_strategy, lb_enabled)
            VALUES (@name, @type, @lb_strategy, @lb_enabled)
        `);
        this.groupUpdate = this.db.prepare(`
            UPDATE groups
               SET name        = COALESCE(@name, name),
                   lb_strategy = COALESCE(@lb_strategy, lb_strategy),
                   lb_enabled  = COALESCE(@lb_enabled, lb_enabled)
             WHERE id = @id
        `);
        this.groupDelete = this.db.prepare(`DELETE FROM groups WHERE id = ?`);
        this.groupSelectAll = this.db.prepare(`SELECT * FROM groups ORDER BY id`);
        this.groupSelectById = this.db.prepare(`SELECT * FROM groups WHERE id = ?`);
        this.groupSelectByName = this.db.prepare(`SELECT * FROM groups WHERE name = ?`);

        this.cpInsert = this.db.prepare(`
            INSERT INTO charge_points (cp_id, display_name, type, group_id, phase_mode, dc_profile, max_power_kw, ocpp_url)
            VALUES (@cp_id, @display_name, @type, @group_id, @phase_mode, @dc_profile, @max_power_kw, @ocpp_url)
        `);
        this.cpUpdate = this.db.prepare(`
            UPDATE charge_points
               SET display_name = COALESCE(@display_name, display_name),
                   group_id     = @group_id,
                   phase_mode   = COALESCE(@phase_mode, phase_mode),
                   dc_profile   = COALESCE(@dc_profile, dc_profile),
                   max_power_kw = COALESCE(@max_power_kw, max_power_kw),
                   ocpp_url     = COALESCE(@ocpp_url, ocpp_url)
             WHERE cp_id = @cp_id
        `);
        this.cpDelete = this.db.prepare(`DELETE FROM charge_points WHERE cp_id = ?`);
        this.cpSelectAll = this.db.prepare(`SELECT * FROM charge_points ORDER BY id`);
        this.cpSelectById = this.db.prepare(`SELECT * FROM charge_points WHERE cp_id = ?`);

        this.sessionInsert = this.db.prepare(`
            INSERT INTO sessions (cp_id, connector_id, id_tag, status, started_at)
            VALUES (@cp_id, @connector_id, @id_tag, 'active', @started_at)
        `);
        this.sessionEnd = this.db.prepare(`
            UPDATE sessions
               SET status        = @status,
                   ended_at      = @ended_at,
                   end_reason    = @end_reason,
                   energy_wh     = @energy_wh,
                   peak_power_kw = @peak_power_kw
             WHERE id = @id
        `);
        this.sessionSelectByStatus = this.db.prepare(`SELECT * FROM sessions WHERE status = ? ORDER BY id DESC`);
        this.sessionSelectAll = this.db.prepare(`SELECT * FROM sessions ORDER BY id DESC LIMIT @limit`);
        this.sessionSelectByCP = this.db.prepare(`SELECT * FROM sessions WHERE cp_id = ? ORDER BY id DESC LIMIT @limit`);
        this.sessionAbortAllActive = this.db.prepare(`
            UPDATE sessions
               SET status     = 'aborted',
                   ended_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                   end_reason = 'manager_restart'
             WHERE status = 'active'
        `);
    }

    close(): void {
        this.db.close();
    }

    /**
     * Backwards-compatible column adds. SQLite's ALTER TABLE only
     * supports `ADD COLUMN`, never DROP / MODIFY, so each migration
     * step is a no-op once applied. We use `pragma table_info` to
     * detect what's present rather than tracking a schema_version
     * counter — at v1 scale, this is plenty.
     */
    private migrate(): void {
        const groupCols = (this.db.pragma('table_info(groups)') as Array<{ name: string }>)
            .map((c) => c.name);
        if (!groupCols.includes('lb_round_robin_cursor')) {
            this.db.exec('ALTER TABLE groups ADD COLUMN lb_round_robin_cursor INTEGER NOT NULL DEFAULT 0');
        }
    }

    /**
     * Atomically increment a group's round-robin cursor and return
     * the new value. Used by the load balancer to pick the next CP
     * in a stable, restart-survivable rotation.
     */
    advanceRoundRobinCursor(groupId: number): number {
        const row = this.db
            .prepare('UPDATE groups SET lb_round_robin_cursor = lb_round_robin_cursor + 1 WHERE id = ? RETURNING lb_round_robin_cursor')
            .get(groupId) as { lb_round_robin_cursor: number } | undefined;
        return row?.lb_round_robin_cursor ?? 0;
    }

    /**
     * Wipe every fleet-owned table. Only called by the dev-reset
     * endpoint (gated by `EVEYS_FLEET_DEV_RESET=1`); never on a
     * normal startup. Disables FK checks for the bulk delete since
     * the normal cascading would force ordering, then re-enables.
     */
    reset(): void {
        this.db.pragma('foreign_keys = OFF');
        this.db.exec('DELETE FROM sessions; DELETE FROM charge_points; DELETE FROM groups;');
        this.db.pragma('foreign_keys = ON');
    }

    // ---- groups ----

    createGroup(args: { name: string; type: CPType; lb_strategy?: LbStrategy; lb_enabled?: boolean }): GroupRow {
        const result = this.groupInsert.run({
            name: args.name,
            type: args.type,
            lb_strategy: args.lb_strategy ?? 'round_robin',
            lb_enabled: args.lb_enabled === false ? 0 : 1,
        });
        const row = this.groupSelectById.get(result.lastInsertRowid) as GroupRow | undefined;
        if (!row) throw new Error(`group ${args.name} created but vanished`);
        return row;
    }

    listGroups(): GroupRow[] {
        return this.groupSelectAll.all() as GroupRow[];
    }

    getGroup(id: number): GroupRow | undefined {
        return this.groupSelectById.get(id) as GroupRow | undefined;
    }

    getGroupByName(name: string): GroupRow | undefined {
        return this.groupSelectByName.get(name) as GroupRow | undefined;
    }

    updateGroup(id: number, patch: Partial<{ name: string; lb_strategy: LbStrategy; lb_enabled: boolean }>): GroupRow | undefined {
        this.groupUpdate.run({
            id,
            name: patch.name ?? null,
            lb_strategy: patch.lb_strategy ?? null,
            lb_enabled: patch.lb_enabled === undefined ? null : (patch.lb_enabled ? 1 : 0),
        });
        return this.getGroup(id);
    }

    deleteGroup(id: number): boolean {
        const r = this.groupDelete.run(id);
        return r.changes > 0;
    }

    // ---- charge points ----

    createCP(args: {
        cp_id: string;
        display_name: string;
        type: CPType;
        group_id?: number | null;
        phase_mode?: PhaseMode;
        dc_profile?: DCBatteryProfile;
        max_power_kw?: number;
        ocpp_url?: string;
    }): CPRow {
        this.cpInsert.run({
            cp_id: args.cp_id,
            display_name: args.display_name,
            type: args.type,
            group_id: args.group_id ?? null,
            phase_mode: args.phase_mode ?? null,
            dc_profile: args.dc_profile ? JSON.stringify(args.dc_profile) : null,
            max_power_kw: args.max_power_kw ?? null,
            ocpp_url: args.ocpp_url ?? null,
        });
        const row = this.getCP(args.cp_id);
        if (!row) throw new Error(`cp ${args.cp_id} created but vanished`);
        return row;
    }

    listCPs(): CPRow[] {
        return this.cpSelectAll.all() as CPRow[];
    }

    getCP(cp_id: string): CPRow | undefined {
        return this.cpSelectById.get(cp_id) as CPRow | undefined;
    }

    updateCP(cp_id: string, patch: Partial<{
        display_name: string;
        group_id: number | null;
        phase_mode: PhaseMode;
        dc_profile: DCBatteryProfile;
        max_power_kw: number;
        ocpp_url: string;
    }>): CPRow | undefined {
        // group_id is intentionally NOT wrapped in COALESCE in the SQL —
        // we want to allow NULL writes (clearing the group). Pass the
        // existing value through if the caller didn't include the key.
        const existing = this.getCP(cp_id);
        if (!existing) return undefined;
        const groupId = 'group_id' in patch ? patch.group_id ?? null : existing.group_id;
        this.cpUpdate.run({
            cp_id,
            display_name: patch.display_name ?? null,
            group_id: groupId,
            phase_mode: patch.phase_mode ?? null,
            dc_profile: patch.dc_profile ? JSON.stringify(patch.dc_profile) : null,
            max_power_kw: patch.max_power_kw ?? null,
            ocpp_url: patch.ocpp_url ?? null,
        });
        return this.getCP(cp_id);
    }

    deleteCP(cp_id: string): boolean {
        const r = this.cpDelete.run(cp_id);
        return r.changes > 0;
    }

    // ---- sessions ----

    insertSession(args: { cp_id: string; connector_id: number; id_tag: string; started_at: string }): number {
        const result = this.sessionInsert.run(args);
        return Number(result.lastInsertRowid);
    }

    endSession(args: { id: number; ended_at: string; end_reason: string; energy_wh: number; peak_power_kw: number; status?: SessionStatus }): void {
        this.sessionEnd.run({
            ...args,
            status: args.status ?? 'completed',
        });
    }

    listSessions(args: { status?: SessionStatus; cp_id?: string; limit?: number } = {}): SessionRow[] {
        const limit = args.limit ?? 100;
        if (args.cp_id) {
            return this.sessionSelectByCP.all(args.cp_id, { limit }) as SessionRow[];
        }
        if (args.status) {
            return this.sessionSelectByStatus.all(args.status) as SessionRow[];
        }
        return this.sessionSelectAll.all({ limit }) as SessionRow[];
    }

    /**
     * On manager startup, any session left in `active` state from
     * the previous process is by definition orphaned — the worker
     * is gone and we can't reconcile its stop. Mark them aborted
     * with a distinguishing reason so the operator sees a clear
     * trail rather than a quietly stuck row.
     */
    abortOrphanedActiveSessions(): number {
        const r = this.sessionAbortAllActive.run();
        return r.changes;
    }
}

/**
 * Parse a CPRow's persisted dc_profile JSON back into the typed
 * shape. Tolerant of malformed JSON (logs and returns undefined)
 * so a single bad row doesn't sink the whole boot.
 */
export function parseDCProfile(row: CPRow): DCBatteryProfile | undefined {
    if (!row.dc_profile) return undefined;
    try {
        return JSON.parse(row.dc_profile) as DCBatteryProfile;
    } catch (err) {
        console.warn(`[sqlite] cp_id=${row.cp_id}: malformed dc_profile JSON, ignoring: ${(err as Error).message}`);
        return undefined;
    }
}
