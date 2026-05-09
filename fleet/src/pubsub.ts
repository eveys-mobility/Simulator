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
 * Per-CP `meter_tick` is intentionally NOT broadcast here: 100 CPs ×
 * 1 Hz × 100 watchers = 10k frames/s and the fleet dashboard doesn't
 * need that fidelity. The single-CP UI keeps the per-CP detail.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { Server as HTTPServer } from 'http';
import { Registry } from './registry';
import { FleetStore } from './sqlite';
import { UpMessage } from './protocol';

interface FleetMessage {
    type: 'cp_state' | 'session_started' | 'session_ended' | 'meter_summary' | 'hello';
    [key: string]: unknown;
}

const SUMMARY_INTERVAL_MS = 1000;

export class FleetPubSub {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();
    private summaryTimer: NodeJS.Timeout | null = null;

    constructor(args: { server: HTTPServer; registry: Registry; store: FleetStore }) {
        const { server, registry, store } = args;
        this.wss = new WebSocketServer({ server, path: '/fleet/ws' });

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            // Initial snapshot so a freshly opened tab doesn't have to
            // wait for the next 1 Hz tick to render anything.
            this.send(ws, {
                type: 'hello',
                cps: registry.list(),
                groups: store.listGroups(),
            });
            ws.on('close', () => this.clients.delete(ws));
            ws.on('error', () => this.clients.delete(ws));
        });

        this.summaryTimer = setInterval(() => {
            this.broadcastMeterSummary(registry, store);
        }, SUMMARY_INTERVAL_MS);
    }

    /** Adapter: turns worker UpMessages into broadcast events. */
    relayUp(cp_id: string, msg: UpMessage): void {
        switch (msg.type) {
            case 'connected':
            case 'disconnected':
            case 'connector_status': {
                // Strip the inner UpMessage's `type` discriminator
                // before spreading — the broadcast envelope wants
                // `type: 'cp_state'`, with the original kind kept as
                // `event` so consumers can branch on the action.
                const { type, ...rest } = msg;
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
            // meter_tick / ready / error: not surfaced to UI consumers
            // at this layer; supervisor logs errors directly.
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
        this.wss.close();
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
