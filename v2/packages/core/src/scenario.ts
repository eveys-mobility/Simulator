import { z } from 'zod';

/**
 * A benchmark scenario describes one configurable load shape: how many
 * synthetic devices to spawn, what mix of AC/DC, how often each one
 * starts a session, how long the run takes overall.
 *
 * The engine on the server reads this and spins up matching activity
 * against the configured OCPP gateway. Devices created by a scenario
 * are always prefixed `bench_` so the cleanup sweep can identify them.
 */
export const ScenarioSchema = z.object({
    name: z.string().min(1).max(80),
    deviceCount: z.number().int().min(1).max(500),
    /** AC | DC | mixed — when mixed, `acFraction` decides the split. */
    deviceMix: z.enum(['AC', 'DC', 'mixed']).default('AC'),
    /** Only honored when deviceMix === 'mixed'. 0 = all DC, 1 = all AC. */
    acFraction: z.number().min(0).max(1).default(0.5),
    /** OCPP URL the synthetic devices connect to. Defaults to the
     *  server's currentDefaultOcppUrl when unspecified. */
    ocppUrl: z.string().url().optional(),
    /** Time over which devices come online — staggered so the gateway
     *  doesn't see a thundering herd. */
    rampUpSeconds: z.number().int().min(0).max(3600).default(10),
    /** Average sessions per hour per device. Sessions fire on a
     *  randomized timer (think Poisson-ish) so they don't all align. */
    sessionsPerHourPerDevice: z.number().min(0).max(60).default(2),
    /** Each session lasts this long, then stops with reason=Local. */
    sessionDurationSeconds: z.number().int().min(5).max(86400).default(60),
    /** OCPP MeterValueSampleInterval pushed to every bench device at
     *  spawn so the gateway sees realistic-cadence metering frames. */
    meterValueIntervalSeconds: z.number().int().min(1).max(3600).default(30),
    /** When the run finishes, delete the synthetic devices it created. */
    autoCleanup: z.boolean().default(true),
    /** Total run duration. Engine stops everything at this mark. */
    totalDurationSeconds: z.number().int().min(10).max(86400).default(300),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenarioStatus = z.enum(['running', 'completed', 'stopped', 'failed']);
export type ScenarioStatus = z.infer<typeof ScenarioStatus>;

export interface BenchmarkRunSummary {
    devicesSpawned: number;
    devicesCleaned: number;
    sessionsStarted: number;
    sessionsStopped: number;
    errors: number;
    /** Wall-clock seconds of the actual run (endedAt - startedAt). */
    elapsedSeconds: number;
}

export interface BenchmarkRun {
    id: number;
    scenario: Scenario;
    status: ScenarioStatus;
    startedAt: string;
    endedAt: string | null;
    summary: BenchmarkRunSummary | null;
}

export interface BenchmarkProgress {
    runId: number;
    /** Seconds since runtime started (monotonic). */
    t: number;
    devicesOnline: number;
    sessionsActive: number;
    sessionsStarted: number;
    sessionsStopped: number;
    errors: number;
}

/** Curated presets surfaced in the UI. Not exhaustive — users can
 *  also customize and run any scenario shape. */
export const SCENARIO_PRESETS: ReadonlyArray<{ key: string; label: string; scenario: Scenario }> = [
    {
        key: 'smoke',
        label: 'Smoke (10 AC, 5 min)',
        scenario: {
            name: 'Smoke',
            deviceCount: 10,
            deviceMix: 'AC',
            acFraction: 1,
            rampUpSeconds: 5,
            sessionsPerHourPerDevice: 6,
            sessionDurationSeconds: 30,
            meterValueIntervalSeconds: 5,
            autoCleanup: true,
            totalDurationSeconds: 300,
        },
    },
    {
        key: 'steady',
        label: 'Steady (100 mixed, 1 h)',
        scenario: {
            name: 'Steady',
            deviceCount: 100,
            deviceMix: 'mixed',
            acFraction: 0.7,
            rampUpSeconds: 60,
            sessionsPerHourPerDevice: 2,
            sessionDurationSeconds: 600,
            meterValueIntervalSeconds: 30,
            autoCleanup: true,
            totalDurationSeconds: 3600,
        },
    },
    {
        key: 'step-ramp',
        label: 'Step ramp (0→200 over 10 min)',
        scenario: {
            name: 'Step ramp',
            deviceCount: 200,
            deviceMix: 'AC',
            acFraction: 1,
            rampUpSeconds: 600,
            sessionsPerHourPerDevice: 4,
            sessionDurationSeconds: 300,
            meterValueIntervalSeconds: 30,
            autoCleanup: true,
            totalDurationSeconds: 1800,
        },
    },
];

export const SCENARIO_PRESET_KEYS = SCENARIO_PRESETS.map((p) => p.key);
