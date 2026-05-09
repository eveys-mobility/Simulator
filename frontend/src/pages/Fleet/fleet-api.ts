/**
 * Thin REST + WS client for the fleet manager (port 3100, proxied
 * via Vite's /fleet rule). Mirrors the shape of services/api.ts but
 * targets the manager's endpoints instead of a single-CP backend.
 */

const FLEET_BASE = '/fleet';
const FLEET_WS_URL = (() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/fleet/ws`;
})();

export type CPType = 'AC' | 'DC';
export type LbStrategy = 'round_robin' | 'least_active';
export type SessionStatus = 'active' | 'completed' | 'aborted';
export type PhaseMode = 'balanced' | 'imbalanced' | 'single-phase';

export interface DCBatteryProfile {
    capacity_kwh?: number;
    charger_max_kw?: number;
    nominal_voltage_v?: number;
    initial_soc_pct?: number;
    target_soc_pct?: number;
    ramp_up_seconds?: number;
}

export interface FleetGroup {
    id: number;
    name: string;
    type: CPType;
    lb_strategy: LbStrategy;
    lb_enabled: number; // 0 / 1
    lb_round_robin_cursor: number;
    created_at: string;
}

export interface FleetCP {
    cp_id: string;
    display_name: string;
    type: CPType;
    worker_alive: boolean;
    online: boolean;
    connector_status: Record<number, string>;
    active_sessions: Record<number, number | null>;
    last_tick: Record<number, { power_kw: number; energy_kwh: number; soc_pct?: number }>;
    phase_mode?: PhaseMode;
    dc_profile?: DCBatteryProfile;
    group_id?: number | null;
}

export interface FleetSession {
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

interface ApiOk<T> { success: true; }
type ApiResult<T extends object> = ApiOk<T> & T;
type ApiErr = { success: false; error: string };

async function request<T extends object>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    const res = await fetch(FLEET_BASE + path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    if (!body.success) {
        const err = (body as ApiErr).error || `HTTP ${res.status}`;
        throw new Error(err);
    }
    return body as ApiResult<T>;
}

// ---- groups ----

export const fleetApi = {
    listGroups(): Promise<FleetGroup[]> {
        return request<{ groups: FleetGroup[] }>('/groups').then((r) => r.groups);
    },
    createGroup(body: { name: string; type: CPType; lb_strategy?: LbStrategy; lb_enabled?: boolean }): Promise<FleetGroup> {
        return request<{ group: FleetGroup }>('/groups', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.group);
    },
    patchGroup(id: number, body: Partial<{ name: string; lb_strategy: LbStrategy; lb_enabled: boolean }>): Promise<FleetGroup> {
        return request<{ group: FleetGroup }>(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }).then((r) => r.group);
    },
    deleteGroup(id: number): Promise<void> {
        return request<{}>(`/groups/${id}`, { method: 'DELETE' }).then(() => undefined);
    },

    // ---- CPs ----

    listCPs(): Promise<FleetCP[]> {
        return request<{ cps: FleetCP[] }>('/cps').then((r) => r.cps);
    },
    createCP(body: {
        type: CPType;
        display_name?: string;
        group_id?: number | null;
        phase_mode?: PhaseMode;
        dc_profile?: DCBatteryProfile;
    }): Promise<FleetCP> {
        return request<{ cp: FleetCP }>('/cps', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.cp);
    },
    deleteCP(cp_id: string): Promise<void> {
        return request<{}>(`/cps/${cp_id}`, { method: 'DELETE' }).then(() => undefined);
    },
    startCharging(cp_id: string, connector_id: number): Promise<void> {
        return request<{}>(`/cps/${cp_id}/actions/start`, {
            method: 'POST',
            body: JSON.stringify({ connector_id }),
        }).then(() => undefined);
    },
    stopCharging(cp_id: string, connector_id: number): Promise<void> {
        return request<{}>(`/cps/${cp_id}/actions/stop`, {
            method: 'POST',
            body: JSON.stringify({ connector_id }),
        }).then(() => undefined);
    },

    // ---- sessions ----

    listSessions(filters: { status?: SessionStatus; cp_id?: string; limit?: number } = {}): Promise<FleetSession[]> {
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);
        if (filters.cp_id) params.set('cp_id', filters.cp_id);
        if (filters.limit !== undefined) params.set('limit', String(filters.limit));
        const qs = params.toString();
        return request<{ sessions: FleetSession[] }>(`/sessions${qs ? '?' + qs : ''}`).then((r) => r.sessions);
    },

    /** LB-driven session start. Returns the picked cp_id+connector_id. */
    startSessionInGroup(group_id: number, body: { id_tag?: string; cp_id?: string; connector_id?: number } = {}): Promise<{ cp_id: string; connector_id: number; id_tag: string }> {
        return request<{ cp_id: string; connector_id: number; id_tag: string }>(`/groups/${group_id}/sessions`, {
            method: 'POST',
            body: JSON.stringify(body),
        }).then((r) => ({ cp_id: r.cp_id, connector_id: r.connector_id, id_tag: r.id_tag }));
    },
};

// ---- WS ----

export interface FleetHelloMessage { type: 'hello'; cps: FleetCP[]; groups: FleetGroup[]; }
export interface FleetCpStateMessage { type: 'cp_state'; cp_id: string; event: string; [k: string]: unknown; }
export interface FleetSessionStartedMessage { type: 'session_started'; cp_id: string; connector_id: number; transaction_id: number; id_tag: string; }
export interface FleetSessionEndedMessage { type: 'session_ended'; cp_id: string; connector_id: number; transaction_id: number; energy_wh: number; peak_power_kw: number; reason: string; }
export interface FleetMeterSummaryMessage { type: 'meter_summary'; group_id: number; total_kw: number; active_sessions: number; }

export type FleetWSMessage =
    | FleetHelloMessage
    | FleetCpStateMessage
    | FleetSessionStartedMessage
    | FleetSessionEndedMessage
    | FleetMeterSummaryMessage;

/**
 * Connect to the fleet manager's WebSocket and dispatch typed
 * messages to the callback. Auto-reconnects every 3 s on close.
 * Returns a cleanup that closes the socket without reconnect.
 */
export function connectFleetWS(onMessage: (msg: FleetWSMessage) => void): () => void {
    let ws: WebSocket | null = null;
    let stopped = false;
    let reconnectTimer: number | null = null;

    const open = (): void => {
        if (stopped) return;
        ws = new WebSocket(FLEET_WS_URL);
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data) as FleetWSMessage;
                onMessage(msg);
            } catch {
                // ignore malformed frames
            }
        };
        ws.onclose = () => {
            if (stopped) return;
            reconnectTimer = window.setTimeout(open, 3000);
        };
        ws.onerror = () => {
            // close handler will fire next; reconnect from there.
        };
    };

    open();

    return (): void => {
        stopped = true;
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    };
}
