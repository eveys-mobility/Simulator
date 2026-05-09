import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getToken } from './auth';
import { type TraceEntry, useLiveStore } from './live-store';

/**
 * Mounts a single WebSocket connection per browser session, fans
 * server pushes into:
 *  - the live store (transient, per-frame state)
 *  - TanStack Query invalidations (so REST-backed data stays fresh)
 *
 * Auto-reconnects with exponential backoff. The hook returns nothing;
 * downstream components subscribe to the live store / query cache.
 */
export function useLiveWs() {
    const setOnline = useLiveStore((s) => s.setOnline);
    const setConnectorStatus = useLiveStore((s) => s.setConnectorStatus);
    const applyTick = useLiveStore((s) => s.applyTick);
    const appendFrame = useLiveStore((s) => s.appendFrame);
    const setBenchmarkProgress = useLiveStore((s) => s.setBenchmarkProgress);
    const qc = useQueryClient();

    useEffect(() => {
        let stopped = false;
        let ws: WebSocket | null = null;
        let attempt = 0;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        const connect = () => {
            if (stopped) return;
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            // Browser WebSocket can't set Authorization headers, so we
            // smuggle the token through the query string. The server's
            // auth hook accepts `?token=`, `Authorization: Bearer`, and
            // the `bearer.<token>` subprotocol.
            const token = getToken();
            const url = `${proto}//${window.location.host}/api/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
            ws = new WebSocket(url);

            ws.onopen = () => {
                attempt = 0;
            };

            ws.onmessage = (ev) => {
                let msg: { type: string; payload?: unknown; devices?: unknown };
                try {
                    msg = JSON.parse(ev.data);
                } catch {
                    return;
                }
                switch (msg.type) {
                    case 'hello': {
                        // Server's snapshot — let TanStack Query cache it.
                        qc.setQueryData(['devices'], msg.devices);
                        break;
                    }
                    case 'state': {
                        const p = msg.payload as { deviceId: string; online?: boolean; connectorId?: number; status?: string };
                        if (typeof p.online === 'boolean') {
                            setOnline(p.deviceId, p.online);
                            // Also dirty the devices query so other consumers refetch lazily.
                            qc.invalidateQueries({ queryKey: ['devices'] });
                        }
                        if (typeof p.connectorId === 'number' && typeof p.status === 'string') {
                            setConnectorStatus(p.deviceId, p.connectorId, p.status as never);
                        }
                        break;
                    }
                    case 'tick': {
                        applyTick(msg.payload as never);
                        break;
                    }
                    case 'session': {
                        qc.invalidateQueries({ queryKey: ['sessions'] });
                        qc.invalidateQueries({ queryKey: ['devices'] });
                        break;
                    }
                    case 'benchmark': {
                        const p = msg.payload as never;
                        setBenchmarkProgress(p);
                        break;
                    }
                    case 'benchmark-done': {
                        qc.invalidateQueries({ queryKey: ['benchmark-runs'] });
                        break;
                    }
                    case 'frame': {
                        const p = msg.payload as Partial<TraceEntry>;
                        if (
                            p &&
                            typeof p.deviceId === 'string' &&
                            (p.direction === 'in' || p.direction === 'out') &&
                            typeof p.action === 'string' &&
                            typeof p.id === 'string'
                        ) {
                            appendFrame({
                                deviceId: p.deviceId,
                                direction: p.direction,
                                action: p.action,
                                id: p.id,
                                at: typeof p.at === 'number' ? p.at : Date.now(),
                                payload: p.payload,
                            });
                        }
                        break;
                    }
                }
            };

            ws.onclose = () => {
                if (stopped) return;
                attempt++;
                const delay = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
                reconnectTimer = setTimeout(connect, delay);
            };
            ws.onerror = () => {
                ws?.close();
            };
        };

        connect();

        return () => {
            stopped = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            ws?.close();
        };
    }, [setOnline, setConnectorStatus, applyTick, appendFrame, setBenchmarkProgress, qc]);
}
