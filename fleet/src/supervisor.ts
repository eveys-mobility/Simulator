/**
 * Worker supervisor: spawns / restarts / terminates CP workers,
 * routes Down messages to them, reflects Up messages into the
 * Registry, and observes worker exits for fault accounting.
 */

import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import { Registry, CPRecord } from './registry';
import {
    DownMessage,
    UpMessage,
    isUpMessage,
    CPType,
    PhaseMode,
    DCBatteryProfile,
} from './protocol';

export interface SpawnSpec {
    cp_id: string;
    display_name: string;
    type: CPType;
    ocpp_url: string;
    phase_mode?: PhaseMode;
    dc_profile?: DCBatteryProfile;
    max_power_kw?: number;
}

interface WorkerHandle {
    worker: Worker;
    /** Restart attempt count since the last successful boot. Resets
     *  when the worker stays alive >60 s (success criterion: no
     *  immediate crash loop). */
    restart_attempts: number;
    /** Timestamp the worker became `ready`. Used to gate the restart
     *  counter reset above. */
    ready_at?: number;
}

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const WORKER_HEALTHY_AFTER_MS = 60_000;

/**
 * Supervises N CP workers. Owns the worker_thread lifecycle and the
 * Registry mutations that flow from worker UpMessages.
 */
export class WorkerSupervisor {
    private workers: Map<string, WorkerHandle> = new Map();
    private specs: Map<string, SpawnSpec> = new Map();
    private listeners: Set<(cp_id: string, msg: UpMessage) => void> = new Set();
    private workerPath: string;
    private registry: Registry;
    private shuttingDown = false;

    constructor(args: { registry: Registry; workerPath?: string }) {
        this.registry = args.registry;
        // worker_threads spawns a fresh node, no loader hooks inherited.
        // In dev (`npm run dev`) we run TS through tsx's CJS hook via a
        // tiny .cjs shim. In prod (`npm run build` then `start`) we point
        // straight at the compiled worker.js. Detection: __filename of
        // *this* module ends in `.ts` only when tsx is in the loader chain.
        const useShim = __filename.endsWith('.ts');
        this.workerPath = args.workerPath ?? (useShim
            ? path.join(__dirname, 'worker-loader.cjs')
            : path.join(__dirname, 'worker.js'));
    }

    /** Subscribe to UpMessages from any worker, tagged with cp_id. */
    onUp(fn: (cp_id: string, msg: UpMessage) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    spawn(spec: SpawnSpec): void {
        if (this.workers.has(spec.cp_id)) {
            throw new Error(`worker for ${spec.cp_id} already exists`);
        }
        this.specs.set(spec.cp_id, spec);
        this.registry.upsert(this.makeRecord(spec));
        this.startWorker(spec, /* attempts */ 0);
    }

    send(cpId: string, msg: DownMessage): boolean {
        const handle = this.workers.get(cpId);
        if (!handle) return false;
        handle.worker.postMessage(msg);
        return true;
    }

    async terminate(cpId: string): Promise<void> {
        const handle = this.workers.get(cpId);
        this.specs.delete(cpId);
        this.registry.remove(cpId);
        if (!handle) return;
        this.workers.delete(cpId);
        try {
            handle.worker.postMessage({ type: 'shutdown' } as DownMessage);
            // Give the worker its 50 ms drain window, then force-stop.
            await new Promise<void>((resolve) => setTimeout(resolve, 200));
            await handle.worker.terminate();
        } catch {
            // ignore — we're tearing down
        }
    }

    async shutdown(): Promise<void> {
        this.shuttingDown = true;
        const ids = Array.from(this.workers.keys());
        await Promise.all(ids.map((id) => this.terminate(id)));
    }

    listSpecs(): SpawnSpec[] {
        return Array.from(this.specs.values());
    }

    private makeRecord(spec: SpawnSpec): CPRecord {
        const connectorIds = spec.type === 'DC' ? [1, 2] : [1];
        const connector_status: Record<number, string> = {};
        const active_sessions: Record<number, number | null> = {};
        for (const id of connectorIds) {
            connector_status[id] = 'Unknown';
            active_sessions[id] = null;
        }
        return {
            cp_id: spec.cp_id,
            display_name: spec.display_name,
            type: spec.type,
            worker_alive: true,
            online: false,
            connector_status,
            active_sessions,
            last_tick: {},
            phase_mode: spec.phase_mode,
            dc_profile: spec.dc_profile,
        };
    }

    private startWorker(spec: SpawnSpec, attempts: number): void {
        const worker = new Worker(this.workerPath, {
            // tsx / ts-node boilerplate is unnecessary here because
            // tsx --test (and the supervisor running under `tsx watch`)
            // both resolve TS files transparently.
            execArgv: process.execArgv,
        });
        const handle: WorkerHandle = { worker, restart_attempts: attempts };
        this.workers.set(spec.cp_id, handle);

        worker.on('message', (raw: unknown) => {
            if (!isUpMessage(raw)) {
                console.warn('[supervisor] dropped malformed Up message from', spec.cp_id, raw);
                return;
            }
            this.applyUpMessage(spec.cp_id, raw, handle);
            for (const fn of this.listeners) fn(spec.cp_id, raw);
        });

        worker.on('error', (err) => {
            // Uncaught exception on the worker side. Mark the CP as
            // disconnected; `exit` will fire next and trigger respawn.
            console.error(`[supervisor] worker error cp=${spec.cp_id}:`, err.message);
            this.registry.patch(spec.cp_id, { online: false });
        });

        worker.on('exit', (code) => {
            const wasAlive = this.workers.get(spec.cp_id) === handle;
            this.workers.delete(spec.cp_id);
            this.registry.patch(spec.cp_id, { worker_alive: false, online: false });

            if (this.shuttingDown || !this.specs.has(spec.cp_id)) return;
            if (!wasAlive) return; // already replaced

            const survivedLongEnough = handle.ready_at && Date.now() - handle.ready_at > WORKER_HEALTHY_AFTER_MS;
            const nextAttempts = survivedLongEnough ? 0 : attempts + 1;
            if (nextAttempts > MAX_RESTART_ATTEMPTS) {
                console.error(`[supervisor] giving up on ${spec.cp_id} after ${nextAttempts} restart attempts`);
                return;
            }
            const backoff = RESTART_BACKOFF_MS[Math.min(nextAttempts, RESTART_BACKOFF_MS.length - 1)];
            console.warn(`[supervisor] worker exit cp=${spec.cp_id} code=${code} attempt=${nextAttempts} backoff=${backoff}ms`);
            setTimeout(() => {
                if (!this.specs.has(spec.cp_id) || this.shuttingDown) return;
                this.registry.patch(spec.cp_id, { worker_alive: true });
                this.startWorker(spec, nextAttempts);
            }, backoff);
        });

        // Send `init` so the worker knows what to be.
        worker.postMessage({
            type: 'init',
            cp_id: spec.cp_id,
            cp_type: spec.type,
            ocpp_url: spec.ocpp_url,
            phase_mode: spec.phase_mode,
            dc_profile: spec.dc_profile,
            max_power_kw: spec.max_power_kw,
        } as DownMessage);
    }

    private applyUpMessage(cpId: string, msg: UpMessage, handle: WorkerHandle): void {
        switch (msg.type) {
            case 'ready':
                handle.ready_at = Date.now();
                break;
            case 'connected':
                this.registry.patch(cpId, { online: true });
                break;
            case 'disconnected':
                this.registry.patch(cpId, { online: false });
                break;
            case 'connector_status':
                this.registry.patch(cpId, {
                    connector_status: { [msg.connector_id]: msg.status },
                });
                break;
            case 'session_started':
                this.registry.patch(cpId, {
                    active_sessions: { [msg.connector_id]: msg.transaction_id },
                });
                break;
            case 'session_ended':
                this.registry.patch(cpId, {
                    active_sessions: { [msg.connector_id]: null },
                });
                break;
            case 'meter_tick':
                this.registry.patch(cpId, {
                    last_tick: {
                        [msg.connector_id]: {
                            power_kw: msg.power_kw,
                            energy_kwh: msg.energy_kwh,
                            soc_pct: msg.soc_pct,
                        },
                    },
                });
                break;
            case 'error':
                console[msg.level === 'error' ? 'error' : 'warn'](`[worker:${cpId}] ${msg.message}`);
                break;
            // 'ready' already handled above.
        }
    }
}
