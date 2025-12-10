const API_BASE_URL = '/api';
const WS_URL = 'ws://localhost:3001/ws';

export interface ChargingSession {
    connectorId: number;
    transactionId?: number;
    idTag: string;
    status: string;
    powerKw: number;
    energyKwh: number;
    duration: number;
    startTime: string;
}

export interface Status {
    connected: boolean;
    sessions: ChargingSession[];
    connectors: Array<{
        id: number;
        status: string;
        hasActiveSession: boolean;
    }>;
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
}

export const api = new ApiService();
