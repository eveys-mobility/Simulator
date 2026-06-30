import { EventEmitter } from 'node:events';
import { v4 as uuid } from 'uuid';
import {
    type BenchmarkProgress,
    type BenchmarkRunSummary,
    DEFAULT_AC_WIRING,
    DCBatteryProfileSchema,
    DEVICE_DEFAULTS,
    type Device,
    type Scenario,
} from '@ocpp-sim/core';
import type { DeviceManager } from './device-manager.js';
import type { Store } from './store.js';

const BENCH_PREFIX = 'bench_';

interface PerDeviceState {
    device: Device;
    nextSessionAt: number; // ms timestamp
    activeConnector: number | null;
    sessionEndAt: number; // 0 if no active session
}

/**
 * Drives one benchmark run end-to-end. Owns the synthetic devices it
 * creates (all prefixed `bench_` so the cleanup sweep can identify
 * stragglers), schedules per-device session start/stop, emits progress
 * once a second, persists summary on completion.
 *
 * The engine is single-use — one Scenario instance per BenchmarkEngine.
 * A new run = a new instance.
 */
export class BenchmarkEngine extends EventEmitter {
    readonly runId: number;
    readonly scenario: Scenario;
    private startedAt = 0;
    private stopRequested = false;
    private completed = false;
    private spawnedIds: string[] = [];
    private state = new Map<string, PerDeviceState>();
    private progressTimer: NodeJS.Timeout | null = null;
    private endTimer: NodeJS.Timeout | null = null;
    private rampTimer: NodeJS.Timeout | null = null;
    private counters = {
        sessionsStarted: 0,
        sessionsStopped: 0,
        errors: 0,
    };

    constructor(
        runId: number,
        scenario: Scenario,
        private readonly manager: DeviceManager,
        private readonly store: Store,
        private readonly defaultOcppUrl: string,
    ) {
        super();
        this.runId = runId;
        this.scenario = scenario;
    }

    /** Start the run. Resolves once the first device begins spawning. */
    async start(): Promise<void> {
        this.startedAt = Date.now();
        const ocppUrl = this.scenario.ocppUrl ?? this.defaultOcppUrl;
        const totalMs = this.scenario.totalDurationSeconds * 1000;

        // 1. Spawn devices over rampUpSeconds. Use a single timer that
        //    spawns one per tick rather than N independent setTimeouts —
        //    keeps the gateway-facing connection rate predictable.
        const rampMs = this.scenario.rampUpSeconds * 1000;
        const intervalMs =
            this.scenario.deviceCount > 0
                ? Math.max(1, Math.floor(rampMs / this.scenario.deviceCount))
                : 1;
        let i = 0;
        const ramp = () => {
            if (this.stopRequested || i >= this.scenario.deviceCount) {
                if (this.rampTimer) clearInterval(this.rampTimer);
                this.rampTimer = null;
                return;
            }
            const idx = i;
            i++;
            this.spawnOne(idx, ocppUrl).catch((err) => {
                this.counters.errors++;
                this.emit('error', err);
            });
        };
        this.rampTimer = setInterval(ramp, intervalMs);
        // Fire one immediately so the first device boot happens right away.
        ramp();

        // 2. Per-second progress + session scheduler tick.
        this.progressTimer = setInterval(() => this.tick(), 1000);

        // 3. Hard cap on total run length.
        this.endTimer = setTimeout(() => {
            void this.finish('completed');
        }, totalMs);
    }

    /** Stop the run cleanly: stop sessions, optionally clean devices, persist summary. */
    async stop(): Promise<void> {
        if (this.completed || this.stopRequested) return;
        this.stopRequested = true;
        await this.finish('stopped');
    }

    private async finish(status: 'completed' | 'stopped' | 'failed'): Promise<void> {
        if (this.completed) return;
        this.completed = true;
        if (this.progressTimer) clearInterval(this.progressTimer);
        if (this.endTimer) clearTimeout(this.endTimer);
        if (this.rampTimer) clearInterval(this.rampTimer);
        this.progressTimer = null;
        this.endTimer = null;
        this.rampTimer = null;

        // Stop any active sessions (count them on the way out).
        let stoppedNow = 0;
        for (const [id, st] of this.state.entries()) {
            if (st.activeConnector !== null) {
                const sim = this.manager.get(id);
                if (sim) {
                    await sim.stopSession(st.activeConnector, 'Local').catch(() => undefined);
                    stoppedNow++;
                }
                st.activeConnector = null;
                st.sessionEndAt = 0;
            }
        }
        this.counters.sessionsStopped += stoppedNow;

        let cleaned = 0;
        if (this.scenario.autoCleanup) {
            for (const id of this.spawnedIds) {
                await this.manager.despawn(id).catch(() => undefined);
                this.store.deleteDevice(id);
                cleaned++;
            }
        }

        const endedAt = new Date().toISOString();
        const elapsedSeconds = Math.round((Date.now() - this.startedAt) / 1000);
        const summary: BenchmarkRunSummary = {
            devicesSpawned: this.spawnedIds.length,
            devicesCleaned: cleaned,
            sessionsStarted: this.counters.sessionsStarted,
            sessionsStopped: this.counters.sessionsStopped,
            errors: this.counters.errors,
            elapsedSeconds,
        };
        this.store.endBenchmarkRun({ id: this.runId, status, endedAt, summary });
        this.emit('done', { runId: this.runId, status, summary });
    }

    private async spawnOne(index: number, ocppUrl: string): Promise<void> {
        const type = pickType(this.scenario, index);
        const id = `${BENCH_PREFIX}${uuid().slice(0, 8)}`;
        const defaults = DEVICE_DEFAULTS[type];
        const device: Device = {
            id,
            displayName: `${this.scenario.name} #${index + 1}`,
            type,
            model: defaults.model,
            vendor: 'Eveys',
            firmwareVersion: '1.0.0',
            maxPowerKw: defaults.maxPowerKw,
            ocppUrl,
            phaseMode: 'balanced',
            acWiring: type === 'AC' ? DEFAULT_AC_WIRING : undefined,
            dcProfile:
                type === 'DC'
                    ? DCBatteryProfileSchema.parse({
                          capacityKwh: 60,
                          chargerMaxKw: defaults.maxPowerKw,
                      })
                    : undefined,
            createdAt: new Date().toISOString(),
        };
        this.store.insertDevice(device);
        this.spawnedIds.push(id);
        await this.manager.spawn(device);
        // Push the meter cadence the scenario asked for.
        const sim = this.manager.get(id);
        sim?.setOcppConfig(
            'MeterValueSampleInterval',
            String(this.scenario.meterValueIntervalSeconds),
        );
        // Schedule the first session at a randomized offset within the
        // average-spacing interval so the fleet doesn't synchronize.
        const avgSpacingMs =
            this.scenario.sessionsPerHourPerDevice > 0
                ? Math.round((3600 / this.scenario.sessionsPerHourPerDevice) * 1000)
                : Number.POSITIVE_INFINITY;
        this.state.set(id, {
            device,
            nextSessionAt:
                avgSpacingMs === Number.POSITIVE_INFINITY
                    ? Number.POSITIVE_INFINITY
                    : Date.now() + Math.floor(Math.random() * avgSpacingMs),
            activeConnector: null,
            sessionEndAt: 0,
        });
    }

    private tick(): void {
        const now = Date.now();
        for (const [id, st] of this.state.entries()) {
            const sim = this.manager.get(id);
            if (!sim) continue;
            const snap = sim.snapshot();
            if (!snap.online) continue;

            // End sessions whose duration elapsed.
            if (st.activeConnector !== null && now >= st.sessionEndAt) {
                sim.stopSession(st.activeConnector, 'Local').catch(() => {
                    this.counters.errors++;
                });
                this.counters.sessionsStopped++;
                st.activeConnector = null;
                st.sessionEndAt = 0;
                // Schedule the next start at avg-spacing from now.
                const avgSpacingMs = Math.round(
                    (3600 / Math.max(0.001, this.scenario.sessionsPerHourPerDevice)) * 1000,
                );
                st.nextSessionAt = now + avgSpacingMs;
                continue;
            }

            // Start a session if it's due and a connector is free.
            if (st.activeConnector === null && now >= st.nextSessionAt) {
                const free = snap.connectors.find(
                    (c) => c.status === 'Available' && c.transactionId === null,
                );
                if (!free) {
                    // Defer; try again next tick.
                    st.nextSessionAt = now + 1000;
                    continue;
                }
                const sessionRowId = this.store.insertSession({
                    deviceId: id,
                    connectorId: free.id,
                    transactionId: 0,
                    idTag: 'BENCH-TAG',
                    status: 'active',
                    startedAt: new Date().toISOString(),
                    endedAt: null,
                    endReason: null,
                    energyWh: 0,
                    peakPowerKw: 0,
                });
                sim.startSession(free.id, 'BENCH-TAG', sessionRowId)
                    .then((txId) => {
                        this.store.db
                            .prepare(`UPDATE sessions SET transaction_id = ? WHERE id = ?`)
                            .run(txId, sessionRowId);
                    })
                    .catch(() => {
                        this.counters.errors++;
                        this.store.endSession({
                            id: sessionRowId,
                            endedAt: new Date().toISOString(),
                            endReason: 'aborted',
                            energyWh: 0,
                            peakPowerKw: 0,
                        });
                    });
                this.counters.sessionsStarted++;
                st.activeConnector = free.id;
                st.sessionEndAt = now + this.scenario.sessionDurationSeconds * 1000;
            }
        }
        this.emitProgress(now);
    }

    private emitProgress(now: number): void {
        let devicesOnline = 0;
        let sessionsActive = 0;
        for (const [id] of this.state.entries()) {
            const sim = this.manager.get(id);
            if (!sim) continue;
            const snap = sim.snapshot();
            if (snap.online) devicesOnline++;
            for (const c of snap.connectors) if (c.transactionId !== null) sessionsActive++;
        }
        const p: BenchmarkProgress = {
            runId: this.runId,
            t: Math.round((now - this.startedAt) / 1000),
            devicesOnline,
            sessionsActive,
            sessionsStarted: this.counters.sessionsStarted,
            sessionsStopped: this.counters.sessionsStopped,
            errors: this.counters.errors,
        };
        this.emit('progress', p);
    }
}

/** Pick AC or DC for the index-th device based on the scenario mix. */
function pickType(s: Scenario, i: number): 'AC' | 'DC' {
    if (s.deviceMix === 'AC') return 'AC';
    if (s.deviceMix === 'DC') return 'DC';
    // Mixed: deterministic distribution rather than random, so a
    // 70/30 mix is exactly 7 AC then 3 DC for 10 devices.
    const wantAcCount = Math.round(s.deviceCount * s.acFraction);
    return i < wantAcCount ? 'AC' : 'DC';
}

export const BENCH_DEVICE_PREFIX = BENCH_PREFIX;
