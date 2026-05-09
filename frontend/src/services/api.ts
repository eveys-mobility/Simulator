const API_BASE_URL = '/api';
const WS_URL = 'ws://localhost:3001/ws';

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

    disconnectWebSocket() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    // HTTP methods
    async getStatus(): Promise<Status> {
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
        const response = await fetch(`${API_BASE_URL}/stop-charging`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectorId, reason })
        });
        return response.json();
    }

    async pauseCharging(connectorId: number = 1): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/pause-charging`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectorId })
        });
        return response.json();
    }

    async resumeCharging(connectorId: number = 1): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/resume-charging`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectorId })
        });
        return response.json();
    }

    async simulateScenario(scenario: string, connectorId: number = 1): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/simulate-scenario`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenario, connectorId })
        });
        return response.json();
    }

    async getScenarios(): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/scenarios`);
        return response.json();
    }

    async getConfig(): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/config`);
        return response.json();
    }

    async sendHeartbeat(): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        return response.json();
    }

    async authorize(idTag: string): Promise<any> {
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
        const response = await fetch(`${API_BASE_URL}/manual-consumption`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        return response.json();
    }

    async setPhaseMode(connectorId: number, mode: PhaseMode): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/connectors/${connectorId}/phase-mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        return response.json();
    }

    async setConnectorType(connectorId: number, type: ConnectorType): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/connectors/${connectorId}/type`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
        });
        return response.json();
    }

    async setDCProfile(connectorId: number, partial: Partial<DCBatteryProfile>): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/connectors/${connectorId}/dc-profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(partial)
        });
        return response.json();
    }
}

export const api = new ApiService();
