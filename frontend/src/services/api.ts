const API_BASE_URL = '/api';
const WS_URL = 'ws://localhost:3001/ws';

/**
 * When the URL has `?cp=<cp_id>` we run in "fleet deep-link" mode:
 * the api client talks to the fleet manager's /fleet/* endpoints
 * and subscribes to its WS for that one cp_id, instead of the
 * per-process backend on :3001. The single-CP UI components don't
 * know — the api shape stays the same.
 *
 * Read once at module load; URL changes during a session aren't
 * supported (and would mean a re-mount anyway).
 */
const fleetCpId: string | null = (() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('cp');
})();
const fleetMode = fleetCpId !== null;
const FLEET_WS_URL = (() => {
    if (typeof window === 'undefined') return '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/fleet/ws`;
})();

export type PhaseMode = 'balanced' | 'imbalanced' | 'single-phase';
export type ConnectorType = 'AC' | 'DC';

export interface PhaseReading {
    voltage_v: number;
    current_a: number;
    power_w: number;
}

export interface PhaseFrame {
    l1: PhaseReading;
    l2: PhaseReading;
    l3: PhaseReading;
    total_p_kw: number;
}

export interface DCFrame {
    soc_pct: number;
    voltage_v: number;
    current_a: number;
    power_w: number;
    delivered_wh: number;
    completed: boolean;
}

export interface DCBatteryProfile {
    capacity_kwh: number;
    charger_max_kw: number;
    nominal_voltage_v?: number;
    initial_soc_pct: number;
    target_soc_pct?: number;
    ramp_up_seconds?: number;
}

export interface ChargingSession {
    connectorId: number;
    transactionId?: number;
    idTag: string;
    status: string;
    powerKw: number;
    energyKwh: number;
    duration: number;
    startTime: string;
    phaseFrame?: PhaseFrame | null;
    dcFrame?: DCFrame | null;
    socPercent?: number;
}

export interface ConnectorState {
    id: number;
    status: string;
    hasActiveSession: boolean;
    connectorType?: ConnectorType;
    phaseMode?: PhaseMode;
    dcProfile?: DCBatteryProfile;
}

export interface Status {
    connected: boolean;
    sessions: ChargingSession[];
    connectors: ConnectorState[];
    numberOfConnectors?: number;
}

class ApiService {
    private ws: WebSocket | null = null;
    private listeners: Map<string, Set<Function>> = new Map();

    // WebSocket methods
    connectWebSocket(onMessage: (data: any) => void) {
        if (this.ws?.readyState === WebSocket.OPEN) return;

        if (fleetMode) {
            this.connectFleetWebSocket(onMessage);
            return;
        }

        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
            console.log('[API] WebSocket connected');
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessage(data);
            } catch (error) {
                console.error('[API] Error parsing WebSocket message:', error);
            }
        };

        this.ws.onclose = () => {
            console.log('[API] WebSocket disconnected, reconnecting...');
            setTimeout(() => this.connectWebSocket(onMessage), 3000);
        };

        this.ws.onerror = (error) => {
            console.error('[API] WebSocket error:', error);
        };
    }

    /**
     * Fleet-mode WebSocket. Connects to /fleet/ws, sends a subscribe
     * for our cp_id, and translates fleet events into the message
     * shapes the existing single-CP components consume:
     *
     *   fleet meter_tick     → emits a `session` push (so the
     *                          Dashboard's powerKw/energyKwh
     *                          metric updates at 1 Hz)
     *   fleet session_started→ event:transactionStarted
     *   fleet session_ended  → event:transactionStopped
     *   fleet cp_state       → event:connected/disconnected
     *
     * The translation is one-directional (fleet → single-CP shape).
     * Anything the components send back via api.startCharging etc.
     * goes through HTTP, not the WS.
     */
    private connectFleetWebSocket(onMessage: (data: any) => void) {
        if (!fleetCpId) return;
        this.ws = new WebSocket(FLEET_WS_URL);

        // Track the latest known session for our cp_id so meter_tick
        // events (which only carry power/energy) can be patched onto
        // a session that already has its connectorId / transactionId.
        let currentSession: ChargingSession | null = null;

        this.ws.onopen = () => {
            console.log('[API] fleet WS connected, subscribing to', fleetCpId);
            this.ws?.send(JSON.stringify({ type: 'subscribe', cp_id: fleetCpId }));
        };

        this.ws.onmessage = (event) => {
            try {
                const m = JSON.parse(event.data);
                switch (m.type) {
                    case 'hello': {
                        // Snapshot — surface the CP's connector list as
                        // a `status` push, mirroring the single-CP API.
                        const cp = (m.cps as any[]).find((c) => c.cp_id === fleetCpId);
                        if (!cp) {
                            // CP doesn't exist in the fleet (yet) — let the
                            // UI decide; it'll show a "not found" state
                            // because getStatus() will throw.
                            return;
                        }
                        const adapted = adaptFleetCpToStatus(cp);
                        currentSession = adapted.sessions[0] ?? null;
                        onMessage({ type: 'status', data: adapted });
                        break;
                    }
                    case 'cp_state': {
                        if (m.cp_id !== fleetCpId) return;
                        if (m.event === 'connected') onMessage({ type: 'event', event: 'connected', data: {} });
                        else if (m.event === 'disconnected') onMessage({ type: 'event', event: 'disconnected', data: {} });
                        // connector_status: nothing to forward as-is;
                        // a refetch will pick it up via the periodic
                        // getStatus poll the App already runs.
                        break;
                    }
                    case 'session_started': {
                        if (m.cp_id !== fleetCpId) return;
                        currentSession = {
                            connectorId: m.connector_id,
                            transactionId: m.transaction_id,
                            idTag: m.id_tag,
                            status: 'Charging',
                            powerKw: 0,
                            energyKwh: 0,
                            duration: 0,
                            startTime: new Date().toISOString(),
                        };
                        onMessage({ type: 'session', data: currentSession });
                        onMessage({ type: 'event', event: 'transactionStarted', data: currentSession });
                        break;
                    }
                    case 'session_ended': {
                        if (m.cp_id !== fleetCpId) return;
                        if (currentSession && currentSession.connectorId === m.connector_id) {
                            currentSession = null;
                        }
                        onMessage({ type: 'session', data: null });
                        onMessage({ type: 'event', event: 'transactionStopped', data: { transaction_id: m.transaction_id } });
                        break;
                    }
                    case 'meter_tick': {
                        if (m.cp_id !== fleetCpId) return;
                        if (!currentSession || currentSession.connectorId !== m.connector_id) {
                            // No session shape known yet — let the periodic
                            // getStatus poll catch up.
                            return;
                        }
                        currentSession = {
                            ...currentSession,
                            powerKw: m.power_kw ?? 0,
                            energyKwh: m.energy_kwh ?? 0,
                            duration: Math.floor(
                                (Date.now() - new Date(currentSession.startTime).getTime()) / 1000,
                            ),
                            socPercent: m.soc_pct,
                        };
                        onMessage({ type: 'session', data: currentSession });
                        break;
                    }
                    // meter_summary frames are fleet-wide and ignored
                    // here; the single-CP UI doesn't render them.
                }
            } catch (err) {
                console.error('[API] fleet WS parse error:', err);
            }
        };

        this.ws.onclose = () => {
            console.log('[API] fleet WS disconnected, reconnecting...');
            setTimeout(() => this.connectFleetWebSocket(onMessage), 3000);
        };

        this.ws.onerror = (err) => {
            console.error('[API] fleet WS error:', err);
        };
    }

    disconnectWebSocket() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    // HTTP methods
    async getStatus(): Promise<Status> {
        if (fleetMode && fleetCpId) {
            try {
                const response = await fetch(`/fleet/cps/${encodeURIComponent(fleetCpId)}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const body = await response.json();
                if (!body.success) throw new Error(body.error ?? 'fleet getStatus failed');
                return adaptFleetCpToStatus(body.cp);
            } catch (error: any) {
                console.error('[API] getStatus (fleet) error:', error);
                throw error;
            }
        }
        try {
            const response = await fetch(`${API_BASE_URL}/status`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error: any) {
            console.error('[API] getStatus error:', error);
            throw error;
        }
    }

    async connect(): Promise<any> {
        // Fleet mode: the worker manages its own gateway connection;
        // no manual connect/disconnect from the UI. Return success
        // so the existing button doesn't surface an error.
        if (fleetMode) return { success: true, message: 'managed by fleet worker' };

        try {
            const response = await fetch(`${API_BASE_URL}/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Connection failed' }));
                throw new Error(error.message || 'Connection failed');
            }
            return await response.json();
        } catch (error: any) {
            console.error('[API] connect error:', error);
            throw error;
        }
    }

    async disconnect(): Promise<any> {
        if (fleetMode) return { success: true, message: 'managed by fleet worker' };
        try {
            const response = await fetch(`${API_BASE_URL}/disconnect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Disconnection failed' }));
                throw new Error(error.message || 'Disconnection failed');
            }
            return await response.json();
        } catch (error: any) {
            console.error('[API] disconnect error:', error);
            throw error;
        }
    }

    async startCharging(connectorId: number = 1, idTag: string = 'TEST-TAG-001'): Promise<any> {
        if (fleetMode && fleetCpId) {
            // The fleet action endpoint expects connector_id / id_tag
            // in snake_case. plug_in semantics: today's worker uses
            // start_charging directly; we just need to make sure the
            // id_tag the user typed is what gets sent. The worker
            // remembers the last plug_in id_tag, so we send both.
            await fleetFetch(`/fleet/cps/${encodeURIComponent(fleetCpId)}/actions/plug-in`, {
                connector_id: connectorId, id_tag: idTag,
            });
            await fleetFetch(`/fleet/cps/${encodeURIComponent(fleetCpId)}/actions/start`, {
                connector_id: connectorId,
            });
            return { success: true };
        }
        try {
            const response = await fetch(`${API_BASE_URL}/start-charging`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connectorId, idTag })
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to start charging' }));
                throw new Error(error.message || 'Failed to start charging');
            }
            return await response.json();
        } catch (error: any) {
            console.error('[API] startCharging error:', error);
            throw error;
        }
    }

    async stopCharging(connectorId: number = 1, reason: string = 'Local'): Promise<any> {
        if (fleetMode && fleetCpId) {
            await fleetFetch(`/fleet/cps/${encodeURIComponent(fleetCpId)}/actions/stop`, {
                connector_id: connectorId, reason,
            });
            return { success: true };
        }
        const response = await fetch(`${API_BASE_URL}/stop-charging`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectorId, reason })
        });
        return response.json();
    }

    async pauseCharging(connectorId: number = 1): Promise<any> {
        if (fleetMode && fleetCpId) {
            await fleetFetch(`/fleet/cps/${encodeURIComponent(fleetCpId)}/actions/pause`, {
                connector_id: connectorId,
            });
            return { success: true };
        }
        const response = await fetch(`${API_BASE_URL}/pause-charging`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectorId })
        });
        return response.json();
    }

    async resumeCharging(connectorId: number = 1): Promise<any> {
        if (fleetMode && fleetCpId) {
            await fleetFetch(`/fleet/cps/${encodeURIComponent(fleetCpId)}/actions/resume`, {
                connector_id: connectorId,
            });
            return { success: true };
        }
        const response = await fetch(`${API_BASE_URL}/resume-charging`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectorId })
        });
        return response.json();
    }

    async simulateScenario(scenario: string, connectorId: number = 1): Promise<any> {
        if (fleetMode) {
            return { success: false, message: 'scenarios not yet supported in fleet mode' };
        }
        const response = await fetch(`${API_BASE_URL}/simulate-scenario`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenario, connectorId })
        });
        return response.json();
    }

    async getScenarios(): Promise<any> {
        if (fleetMode) return { scenarios: [] };
        const response = await fetch(`${API_BASE_URL}/scenarios`);
        return response.json();
    }

    async getConfig(): Promise<any> {
        if (fleetMode) return { configuration: [], count: 0 };
        const response = await fetch(`${API_BASE_URL}/config`);
        return response.json();
    }

    async sendHeartbeat(): Promise<any> {
        if (fleetMode) return { success: false, message: 'manual heartbeat not in fleet mode' };
        const response = await fetch(`${API_BASE_URL}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        return response.json();
    }

    async authorize(idTag: string): Promise<any> {
        if (fleetMode) return { success: false, message: 'manual authorize not in fleet mode' };
        const response = await fetch(`${API_BASE_URL}/authorize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idTag })
        });
        return response.json();
    }

    async manualConsumption(params: {
        connectorId?: number;
        energyWh: number;
        mode: 'single' | 'split';
        splitCount?: number;
    }): Promise<any> {
        if (fleetMode) return { success: false, message: 'manual consumption not in fleet mode' };
        const response = await fetch(`${API_BASE_URL}/manual-consumption`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        return response.json();
    }

    async setPhaseMode(connectorId: number, mode: PhaseMode): Promise<any> {
        if (fleetMode && fleetCpId) {
            // Fleet manager has no per-connector phase-mode endpoint;
            // we patch the CP-level phase_mode (which the spawn /
            // restart cycle consumes). Live mid-session change isn't
            // supported in fleet mode yet.
            await fleetFetch(`/fleet/cps/${encodeURIComponent(fleetCpId)}`, { phase_mode: mode }, 'PATCH');
            return { success: true };
        }
        const response = await fetch(`${API_BASE_URL}/connectors/${connectorId}/phase-mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        return response.json();
    }

    async setConnectorType(connectorId: number, type: ConnectorType): Promise<any> {
        if (fleetMode) return { success: false, message: 'connector type is set at spawn in fleet mode' };
        const response = await fetch(`${API_BASE_URL}/connectors/${connectorId}/type`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
        });
        return response.json();
    }

    async setDCProfile(connectorId: number, partial: Partial<DCBatteryProfile>): Promise<any> {
        if (fleetMode && fleetCpId) {
            await fleetFetch(`/fleet/cps/${encodeURIComponent(fleetCpId)}`, { dc_profile: partial }, 'PATCH');
            return { success: true };
        }
        const response = await fetch(`${API_BASE_URL}/connectors/${connectorId}/dc-profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(partial)
        });
        return response.json();
    }
}

export const api = new ApiService();

/** Whether the page is rendering against a fleet-managed CP. */
export const isFleetDeepLink = (): boolean => fleetMode;
/** The cp_id from the URL when in fleet deep-link mode, else null. */
export const getFleetCpId = (): string | null => fleetCpId;

/**
 * Tiny helper for the fleet HTTP calls — same envelope shape as
 * pages/Fleet/fleet-api.ts but kept private here so `services/api.ts`
 * doesn't pull in that whole module (and circular it back).
 */
async function fleetFetch(path: string, body?: any, method: 'POST' | 'PATCH' | 'DELETE' = 'POST'): Promise<any> {
    const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    if (!json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
}

/**
 * Adapt a /fleet/cps/:cp_id row (or a `hello` snapshot CP entry)
 * into the `Status` shape the existing single-CP UI components
 * already render. Lets us reuse Dashboard / ChargingControls /
 * PhaseReadout / DCReadout unchanged in fleet mode.
 *
 * The fleet shape carries connector_status as `Record<number, string>`
 * and active_sessions as `Record<number, number | null>`; the
 * single-CP shape wants two parallel arrays. We materialise both.
 */
function adaptFleetCpToStatus(cp: any): Status {
    const connectors: ConnectorState[] = Object.entries(cp.connector_status ?? {})
        .map(([id, status]) => ({
            id: Number(id),
            status: String(status),
            hasActiveSession: cp.active_sessions?.[id] != null,
            connectorType: cp.type,
            phaseMode: cp.phase_mode,
            dcProfile: cp.dc_profile,
        }))
        .sort((a, b) => a.id - b.id);

    const sessions: ChargingSession[] = Object.entries(cp.active_sessions ?? {})
        .filter(([, txId]) => txId != null)
        .map(([connectorId, txId]) => {
            const tick = cp.last_tick?.[connectorId] ?? {};
            return {
                connectorId: Number(connectorId),
                transactionId: txId as number,
                idTag: 'TEST-TAG-001',     // not carried in /fleet/cps; the WS session_started carries it for live updates
                status: cp.connector_status?.[connectorId] === 'Charging' ? 'Charging' : 'Preparing',
                powerKw: tick.power_kw ?? 0,
                energyKwh: tick.energy_kwh ?? 0,
                duration: 0,                // best-effort; live duration comes from WS
                startTime: new Date().toISOString(),
                socPercent: tick.soc_pct,
            };
        });

    return {
        connected: !!cp.online,
        sessions,
        connectors,
        numberOfConnectors: connectors.length,
    };
}
