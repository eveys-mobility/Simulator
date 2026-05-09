/**
 * WebSocket broadcast for the fleet UI.
 *
 * Channels (all coalesced into a single `/fleet/ws` endpoint):
 *
 *   cp_state         — per-CP status flips (online, status, has_session)
 *   session_started  — mirrors the worker UpMessage
 *   session_ended    — mirrors the worker UpMessage
 *   meter_summary    — group rollup at 1 Hz (total_kw, active_sessions)
 *
 * Plus per-CP subscriptions: a client sends `{type:'subscribe',cp_id}`
 * and starts receiving `meter_tick` + (per-CP-tagged) `cp_state`,
 * `session_started`, `session_ended` for that cp_id only. This is
 * what the deep-linked single-CP UI uses — see frontend
 * services/api.ts. Without an explicit subscribe the client gets
 * only the broadcast channels above (the fleet dashboard's needs).
 *
 * Per-CP `meter_tick` is deliberately scoped to subscribers:
 * 100 CPs × 1 Hz × 100 fleet-dashboard tabs = 10 k frames/s, and
 * the dashboard doesn't need that fidelity. Single-CP detail tabs
 * subscribe to one cp_id and get exactly what they need.
 */

import WS, { WebSocket, WebSocketServer } from 'ws';
import { Server as HTTPServer } from 'http';
import { Registry } from './registry';
import { FleetStore } from './sqlite';
import { UpMessage } from './protocol';

interface FleetMessage {
    type:
        | 'cp_state'
        | 'session_started'
        | 'session_ended'
        | 'meter_summary'
        | 'meter_tick'
        | 'hello';
    [key: string]: unknown;
}

interface ClientCommand {
    type: 'subscribe' | 'unsubscribe';
    cp_id?: string;
}

function isClientCommand(value: unknown): value is ClientCommand {
    if (typeof value !== 'object' || value === null) return false;
    const t = (value as { type?: unknown }).type;
    return t === 'subscribe' || t === 'unsubscribe';
}

const SUMMARY_INTERVAL_MS = 1000;

export class FleetPubSub {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();
    /** Per-client subscription set: cp_ids the client wants per-CP
     *  events for. Lookups happen on every relayUp call, so this
     *  is a hot map — keep it on the WebSocket instance via a
     *  WeakMap-style attached field. We use a parallel Map here so
     *  TypeScript doesn't have to widen the WebSocket type. */
    private subscriptions: Map<WebSocket, Set<string>> = new Map();
    private summaryTimer: NodeJS.Timeout | null = null;

    constructor(args: { server: HTTPServer; registry: Registry; store: FleetStore }) {
        const { server, registry, store } = args;
        this.wss = new WebSocketServer({ server, path: '/fleet/ws' });

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            this.subscriptions.set(ws, new Set());
            // Initial snapshot so a freshly opened tab doesn't have to
            // wait for the next 1 Hz tick to render anything.
            this.send(ws, {
                type: 'hello',
                cps: registry.list(),
                groups: store.listGroups(),
            });
            ws.on('message', (raw) => this.handleClientMessage(ws, raw));
            ws.on('close', () => {
                this.clients.delete(ws);
                this.subscriptions.delete(ws);
            });
            ws.on('error', () => {
                this.clients.delete(ws);
                this.subscriptions.delete(ws);
            });
        });

        this.summaryTimer = setInterval(() => {
            this.broadcastMeterSummary(registry, store);
        }, SUMMARY_INTERVAL_MS);
    }

    /** Adapter: turns worker UpMessages into broadcast / unicast
     *  events depending on type and per-CP subscriptions. */
    relayUp(cp_id: string, msg: UpMessage): void {
        switch (msg.type) {
            case 'connected':
            case 'disconnected':
            case 'connector_status': {
                const { type, ...rest } = msg;
                // Fleet-wide broadcast for the dashboard…
                this.broadcast({ type: 'cp_state', cp_id, event: type, ...rest });
                break;
            }
            case 'session_started': {
                const { type, ...rest } = msg;
                this.broadcast({ type: 'session_started', cp_id, ...rest });
                break;
            }
            case 'session_ended': {
                const { type, ...rest } = msg;
                this.broadcast({ type: 'session_ended', cp_id, ...rest });
                break;
            }
            case 'meter_tick': {
                // Per-CP subscribers only. Single-CP detail tabs
                // subscribe to one cp_id; the fleet dashboard does
                // not subscribe and so doesn't see this stream.
                const { type, ...rest } = msg;
                this.unicastToSubscribers(cp_id, { type: 'meter_tick', cp_id, ...rest });
                break;
            }
            // ready / error / pong: not surfaced to UI consumers at
            // this layer; supervisor logs errors directly.
        }
    }

    close(): void {
        if (this.summaryTimer) {
            clearInterval(this.summaryTimer);
            this.summaryTimer = null;
        }
        for (const c of this.clients) {
            try { c.close(); } catch { /* shutting down */ }
        }
        this.clients.clear();
        this.subscriptions.clear();
        this.wss.close();
    }

    private handleClientMessage(ws: WebSocket, raw: WS.Data): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw.toString());
        } catch {
            return; // ignore malformed
        }
        if (!isClientCommand(parsed)) return;
        const cmd = parsed;
        if (typeof cmd.cp_id !== 'string' || cmd.cp_id.length === 0) return;
        const subs = this.subscriptions.get(ws);
        if (!subs) return;
        if (cmd.type === 'subscribe') subs.add(cmd.cp_id);
        else subs.delete(cmd.cp_id);
    }

    private send(ws: WebSocket, msg: FleetMessage): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(msg));
    }

    private broadcast(msg: FleetMessage): void {
        const wire = JSON.stringify(msg);
        for (const ws of this.clients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(wire);
        }
    }

    /**
     * Send a message only to clients subscribed to this cp_id.
     * Used for high-cardinality streams (meter_tick) that a fleet
     * dashboard doesn't want but a single-CP detail tab does.
     */
    private unicastToSubscribers(cp_id: string, msg: FleetMessage): void {
        const wire = JSON.stringify(msg);
        for (const ws of this.clients) {
            const subs = this.subscriptions.get(ws);
            if (!subs || !subs.has(cp_id)) continue;
            if (ws.readyState === WebSocket.OPEN) ws.send(wire);
        }
    }

    /**
     * Per-group power + active-session rollup. Walks the registry's
     * last_tick values and the persisted group_id mapping (read from
     * SQLite each tick — cheap, indexed, no n+1).
     */
    private broadcastMeterSummary(registry: Registry, store: FleetStore): void {
        if (this.clients.size === 0) return;

        const groups = store.listGroups();
        const cpsByGroup = new Map<number, string[]>();
        for (const row of store.listCPs()) {
            if (row.group_id == null) continue;
            const arr = cpsByGroup.get(row.group_id) ?? [];
            arr.push(row.cp_id);
            cpsByGroup.set(row.group_id, arr);
        }

        for (const g of groups) {
            const cps = cpsByGroup.get(g.id) ?? [];
            let total_kw = 0;
            let active_sessions = 0;
            for (const cpId of cps) {
                const r = registry.get(cpId);
                if (!r) continue;
                for (const tick of Object.values(r.last_tick)) {
                    if (tick.power_kw > 0) total_kw += tick.power_kw;
                }
                active_sessions += registry.activeSessionCount(cpId);
            }
            this.broadcast({
                type: 'meter_summary',
                group_id: g.id,
                total_kw: Math.round(total_kw * 100) / 100,
                active_sessions,
            });
        }
    }
}
