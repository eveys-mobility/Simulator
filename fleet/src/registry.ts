/**
 * In-memory registry of CP runtime state.
 *
 * v1: just an authoritative source for "which CPs exist, what's
 * their type, are they connected, do they have a session running".
 * Backed by plain Maps; SQLite lands in MR-E.
 *
 * Concurrency note: only the main thread mutates this. Workers
 * post UpMessages, the supervisor patches state, the API serves
 * snapshots. No locking needed.
 */

import { CPType, PhaseMode, DCBatteryProfile } from './protocol';

export interface CPRecord {
    cp_id: string;
    display_name: string;
    type: CPType;
    /** True between worker spawn and supervisor termination. False
     *  when the row exists in the registry but no worker is running
     *  yet (rare — only during respawn backoff). */
    worker_alive: boolean;
    /** True when the worker has reported `connected` from the OCPP
     *  WebSocket (and not since reported `disconnected`). */
    online: boolean;
    /** Per-connector status, keyed by connector id. Filled in as the
     *  worker emits StatusNotifications. AC = 1 connector, DC = 2. */
    connector_status: Record<number, string>;
    /** Per-connector active session id; `null` when idle. */
    active_sessions: Record<number, number | null>;
    /** Live 1 Hz telemetry. Optional — not present until the worker's
     *  first meter_tick. */
    last_tick: Record<number, { power_kw: number; energy_kwh: number; soc_pct?: number }>;
    phase_mode?: PhaseMode;
    dc_profile?: DCBatteryProfile;
}

export class Registry {
    private cps: Map<string, CPRecord> = new Map();

    upsert(record: CPRecord): void {
        this.cps.set(record.cp_id, record);
    }

    get(cpId: string): CPRecord | undefined {
        return this.cps.get(cpId);
    }

    list(): CPRecord[] {
        return Array.from(this.cps.values());
    }

    remove(cpId: string): boolean {
        return this.cps.delete(cpId);
    }

    /**
     * Apply a partial update to a CP row. Returns the new record
     * (or undefined if the cp_id was unknown). Caller is responsible
     * for serialising via the supervisor's event handler — Registry
     * itself doesn't synchronise.
     */
    patch(cpId: string, patch: Partial<CPRecord>): CPRecord | undefined {
        const existing = this.cps.get(cpId);
        if (!existing) return undefined;
        const merged: CPRecord = {
            ...existing,
            ...patch,
            connector_status: { ...existing.connector_status, ...(patch.connector_status ?? {}) },
            active_sessions: { ...existing.active_sessions, ...(patch.active_sessions ?? {}) },
            last_tick: { ...existing.last_tick, ...(patch.last_tick ?? {}) },
        };
        this.cps.set(cpId, merged);
        return merged;
    }

    /**
     * Count active sessions for a CP — equivalent to "how many
     * connectors are currently delivering energy". MR-F's
     * least_active load balancer reads this.
     */
    activeSessionCount(cpId: string): number {
        const r = this.cps.get(cpId);
        if (!r) return 0;
        return Object.values(r.active_sessions).filter((v) => v !== null).length;
    }
}

/**
 * Generate an opaque CP id of the form `cp_<6 hex>`. Per the spec's
 * resolved-questions section: opaque ids decouple identity from
 * group/org renames. The friendly display name lives in
 * `CPRecord.display_name`.
 */
export function generateCPId(): string {
    const hex = Math.floor(Math.random() * 0xffffff)
        .toString(16)
        .padStart(6, '0');
    return `cp_${hex}`;
}
