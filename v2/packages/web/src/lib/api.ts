import type { AcWiring, Connector, DCBatteryProfile, Device, DeviceType, PhaseMode, Session } from '@ocpp-sim/core';
import { clearToken, getToken } from './auth';

export interface DeviceWithRuntime extends Device {
    online: boolean;
    connectors: Pick<Connector, 'id' | 'status'>[] & { transactionId?: number | null }[];
    /** Backend strips the actual password; only this presence flag is sent. */
    hasAuthPassword?: boolean;
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
        // Token was good when we loaded the page, but expired or got
        // rotated server-side. Clear it and reload so the auth gate
        // re-renders the login screen.
        clearToken();
        window.location.reload();
        // Throw so the caller's promise chain still rejects.
        throw new Error('unauthorized');
    }
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export const api = {
    listDevices: () => http<DeviceWithRuntime[]>('GET', '/devices'),
    getDevice: (id: string) => http<DeviceWithRuntime>('GET', `/devices/${id}`),
    createDevice: (body: {
        type: DeviceType;
        displayName?: string;
        maxPowerKw?: number;
        phaseMode?: PhaseMode;
    }) => http<DeviceWithRuntime>('POST', '/devices', body),
    updateDevice: (
        id: string,
        body: {
            displayName?: string;
            vendor?: string;
            firmwareVersion?: string;
            maxPowerKw?: number;
            ocppUrl?: string;
            authPassword?: string;
            phaseMode?: PhaseMode;
            acWiring?: Partial<AcWiring>;
            dcProfile?: Partial<DCBatteryProfile>;
        },
    ) => http<DeviceWithRuntime>('PATCH', `/devices/${id}`, body),
    deleteDevice: (id: string) => http<void>('DELETE', `/devices/${id}`),
    startSession: (deviceId: string, connectorId: number) =>
        http<{ sessionId: number; transactionId: number }>('POST', `/devices/${deviceId}/sessions`, { connectorId }),
    stopSession: (deviceId: string, connectorId: number, reason = 'Local') =>
        http<{ ok: true }>('POST', `/devices/${deviceId}/sessions/stop`, { connectorId, reason }),
    plugIn: (deviceId: string, connectorId: number) =>
        http<{ ok: true }>('POST', `/devices/${deviceId}/actions/plug-in`, { connectorId }),
    plugOut: (deviceId: string, connectorId: number) =>
        http<{ ok: true }>('POST', `/devices/${deviceId}/actions/plug-out`, { connectorId }),
    swipe: (deviceId: string, connectorId: number, idTag: string) =>
        http<{ ok: true; outcome: 'started' | 'stopped' | 'rejected' }>(
            'POST',
            `/devices/${deviceId}/actions/swipe`,
            { connectorId, idTag },
        ),
    injectFault: (
        deviceId: string,
        body: { connectorId: number; errorCode?: string; clearAfterSeconds?: number },
    ) => http<{ ok: true }>('POST', `/devices/${deviceId}/actions/fault`, body),
    clearFault: (deviceId: string, connectorId: number) =>
        http<{ ok: true }>('POST', `/devices/${deviceId}/actions/clear-fault`, { connectorId }),
    emergencyStop: (deviceId: string) =>
        http<{ ok: true }>('POST', `/devices/${deviceId}/actions/emergency-stop`),
    reboot: (deviceId: string, type: 'Soft' | 'Hard') =>
        http<{ ok: true }>('POST', `/devices/${deviceId}/actions/reboot`, { type }),

    bulkCreateDevices: (body: {
        count: number;
        type: DeviceType;
        namePrefix?: string;
        ocppUrl?: string;
        staggerMs?: number;
    }) => http<{ created: number; devices: DeviceWithRuntime[] }>('POST', '/devices/bulk', body),

    fleetSummary: () =>
        http<{
            total: number;
            online: number;
            offline: number;
            chargingConnectors: number;
            activeConnectors: number;
        }>('GET', '/fleet/summary'),

    fleetStartFraction: (body: { fraction: number; idTag?: string }) =>
        http<{ eligible: number; picked: number; started: number; errors: string[] }>(
            'POST',
            '/fleet/start',
            body,
        ),

    fleetReconnect: () => http<{ reconnecting: number }>('POST', '/fleet/reconnect'),

    fleetHeartbeatInterval: (seconds: number) =>
        http<{ updated: number; seconds: number }>('POST', '/fleet/heartbeat-interval', { seconds }),

    fleetEmergencyStop: () => http<{ stopped: number }>('POST', '/fleet/emergency-stop'),

    listChargingProfiles: (deviceId: string) =>
        http<Array<{ connectorId: number; profile: import('@ocpp-sim/core').ChargingProfile }>>(
            'GET',
            `/devices/${deviceId}/charging-profiles`,
        ),

    listBenchmarkPresets: () =>
        http<Array<{ key: string; label: string; scenario: import('@ocpp-sim/core').Scenario }>>(
            'GET',
            '/benchmark/presets',
        ),
    listBenchmarkRuns: (q: { limit?: number; offset?: number } = {}) => {
        const params = new URLSearchParams();
        if (q.limit !== undefined) params.set('limit', String(q.limit));
        if (q.offset !== undefined) params.set('offset', String(q.offset));
        const qs = params.toString();
        return http<{ runs: import('@ocpp-sim/core').BenchmarkRun[]; total: number }>(
            'GET',
            `/benchmark/runs${qs ? '?' + qs : ''}`,
        );
    },
    getBenchmarkRun: (id: number) =>
        http<import('@ocpp-sim/core').BenchmarkRun>('GET', `/benchmark/runs/${id}`),
    startBenchmarkRun: (scenario: import('@ocpp-sim/core').Scenario) =>
        http<import('@ocpp-sim/core').BenchmarkRun>('POST', '/benchmark/runs', scenario),
    stopBenchmarkRun: (id: number) =>
        http<{ ok: true }>('POST', `/benchmark/runs/${id}/stop`),

    fleetStopAll: () =>
        http<{ devices: number; sessionsStopped: number }>('POST', '/fleet/stop-all'),

    resetDatabase: () =>
        http<{ ok: true; devices: number }>('POST', '/settings/reset', { confirm: 'DELETE' }),

    getSettings: () => http<{ defaultOcppUrl: string }>('GET', '/settings'),
    updateSettings: (body: { defaultOcppUrl: string }) =>
        http<{ defaultOcppUrl: string }>('PUT', '/settings', body),

    listSessions: (
        q: {
            status?: 'active' | 'completed' | 'aborted';
            deviceId?: string;
            idTag?: string;
            since?: string;
            until?: string;
            limit?: number;
            offset?: number;
        } = {},
    ) => {
        const params = new URLSearchParams();
        if (q.status) params.set('status', q.status);
        if (q.deviceId) params.set('deviceId', q.deviceId);
        if (q.idTag) params.set('idTag', q.idTag);
        if (q.since) params.set('since', q.since);
        if (q.until) params.set('until', q.until);
        if (q.limit !== undefined) params.set('limit', String(q.limit));
        if (q.offset !== undefined) params.set('offset', String(q.offset));
        const qs = params.toString();
        return http<{ sessions: Session[]; total: number; limit: number; offset: number }>(
            'GET',
            `/sessions${qs ? '?' + qs : ''}`,
        );
    },
};
