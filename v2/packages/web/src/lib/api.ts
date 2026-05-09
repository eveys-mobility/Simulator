import type { AcWiring, Connector, DCBatteryProfile, Device, DeviceType, PhaseMode, Session } from '@ocpp-sim/core';

export interface DeviceWithRuntime extends Device {
    online: boolean;
    connectors: Pick<Connector, 'id' | 'status'>[] & { transactionId?: number | null }[];
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
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

    getSettings: () => http<{ defaultOcppUrl: string }>('GET', '/settings'),
    updateSettings: (body: { defaultOcppUrl: string }) =>
        http<{ defaultOcppUrl: string }>('PUT', '/settings', body),

    listSessions: (q: { status?: 'active' | 'completed' | 'aborted'; deviceId?: string; limit?: number } = {}) => {
        const params = new URLSearchParams();
        if (q.status) params.set('status', q.status);
        if (q.deviceId) params.set('deviceId', q.deviceId);
        if (q.limit !== undefined) params.set('limit', String(q.limit));
        const qs = params.toString();
        return http<Session[]>('GET', `/sessions${qs ? '?' + qs : ''}`);
    },
};
