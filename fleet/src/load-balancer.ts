/**
 * Session-assignment load balancer.
 *
 * Pure function — given (group, candidates, registry), returns the
 * cp_id + connector_id that should host the next session, or null
 * if nothing fits. The caller (sessions API) is responsible for
 * actually starting the session and bumping the round-robin
 * cursor.
 *
 * Power-cap distribution (SetChargingProfile) is v2 — see the spec.
 */

import { Registry } from './registry';
import { GroupRow, CPRow, LbStrategy } from './sqlite';

export interface PickResult {
    cp_id: string;
    connector_id: number;
}

/**
 * Pick a CP + connector to host a new session in the given group.
 *
 * Eligibility rules (apply to both strategies):
 *   - CP must belong to the group.
 *   - CP must be in the runtime registry (i.e. its worker is alive).
 *   - CP must be online (WS to gateway is up).
 *   - At least one of its connectors must read 'Available'.
 *
 * Round-robin (default): orders eligible CPs by cp_id (stable
 * across restarts) and selects index `cursor % len`. Caller bumps
 * the cursor after a successful start. If multiple connectors on
 * the chosen CP are free, picks the lowest-numbered one.
 *
 * Least-active: selects the CP with the fewest active sessions;
 * ties broken by cp_id for determinism.
 *
 * Either way, returns null if no candidate is eligible — the API
 * surfaces that to the caller as 503 (no capacity).
 */
export function pickCp(args: {
    group: GroupRow;
    candidates: CPRow[];          // pre-filtered to group_id = group.id
    registry: Registry;
    /** Round-robin cursor — caller passes the current value, gets
     *  back a result; only after a successful start does the caller
     *  call advanceRoundRobinCursor in SQLite. */
    cursor?: number;
}): PickResult | null {
    const { group, candidates, registry, cursor = 0 } = args;
    const eligible = candidates
        .map((cp) => ({ cp, runtime: registry.get(cp.cp_id) }))
        .filter(({ runtime }) => runtime !== undefined && runtime.worker_alive && runtime.online)
        .map(({ cp, runtime }) => ({
            cp,
            free_connectors: Object.entries(runtime!.connector_status)
                .filter(([, status]) => status === 'Available')
                .map(([id]) => Number(id))
                .sort((a, b) => a - b),
            active_sessions: registry.activeSessionCount(cp.cp_id),
        }))
        .filter((c) => c.free_connectors.length > 0);

    if (eligible.length === 0) return null;

    if (group.lb_strategy === ('least_active' satisfies LbStrategy)) {
        // Sort ascending by active count, ties broken by cp_id for
        // determinism (so test expectations and ops debugging both
        // see the same sequence).
        eligible.sort((a, b) =>
            a.active_sessions - b.active_sessions || a.cp.cp_id.localeCompare(b.cp.cp_id),
        );
        const winner = eligible[0];
        return { cp_id: winner.cp.cp_id, connector_id: winner.free_connectors[0] };
    }

    // round_robin
    eligible.sort((a, b) => a.cp.cp_id.localeCompare(b.cp.cp_id));
    const winner = eligible[cursor % eligible.length];
    return { cp_id: winner.cp.cp_id, connector_id: winner.free_connectors[0] };
}
