import { DEFAULT_AC_WIRING, type Device } from '@ocpp-sim/core';
import { type DeviceHandle, MockCsms, type MockCsmsOptions } from '@ocpp-sim/csms';
import { Simulator, Store } from '@ocpp-sim/server/lib';

export interface ConformanceContext {
    csms: MockCsms;
    sim: Simulator;
    handle: DeviceHandle;
    device: Device;
    store: Store;
}

export interface ConformanceCase {
    /** Short id for reports — e.g. "core.boot.accepted". */
    id: string;
    /** Human title — e.g. "BootNotification → CSMS Accepts → device emits Heartbeat". */
    title: string;
    /** OCPP profile this case belongs to (Core, FirmwareManagement, ...). */
    profile: 'Core' | 'FirmwareManagement' | 'LocalAuthListManagement' | 'Reservation' | 'SmartCharging' | 'RemoteTrigger';
    /** How long to wait before the runner gives up. */
    timeoutMs?: number;
    /** Set up overrides for the MockCsms. Each case spins up its own
     *  CSMS so handlers don't bleed across cases. */
    csmsOptions?: MockCsmsOptions;
    /** Set up overrides for the Device record. Defaults to a 22kW AC. */
    deviceOverrides?: Partial<Device>;
    /** Mark cases for features the simulator hasn't built yet (Reservation,
     *  LocalAuthListManagement, FirmwareManagement). The suite runner
     *  *skips* the body and reports `unimplemented` instead of running
     *  it as failed — accurate signalling that the gap is known and
     *  expected, not a regression. Setting this to a string makes it
     *  the displayed reason in the SPA / CLI output. */
    unimplemented?: boolean | string;
    /** The actual check. Throws (or `expect()` fails) on non-conformance. */
    run: (ctx: ConformanceContext) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Spin up a fresh MockCsms + Simulator pair, run the case body,
 * tear everything down. Re-thrown errors carry the case id so the
 * test runner output points to the right line.
 *
 * Each call gets its own port-0 CSMS and `:memory:` Store, so cases
 * are isolated and parallel-safe. The simulator is started before
 * `run` is invoked; the case body is responsible for waiting on the
 * Boot frame if it cares about ordering.
 */
export async function runConformanceCase(c: ConformanceCase): Promise<void> {
    const csms = new MockCsms(c.csmsOptions);
    await csms.start();
    const store = new Store(':memory:');

    const device = buildDevice({ id: 'cp_conformance', ocppUrl: csms.url, ...c.deviceOverrides });
    store.insertDevice(device);
    const sim = new Simulator(device, store);
    // Swallow non-fatal errors — the test runner already surfaces
    // assertion failures, and a transient `client stopped` reject
    // during teardown is just noise.
    sim.on('error', () => undefined);
    await sim.start();

    const handle = await csms.waitForDevice(device.id, c.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
        await withTimeout(
            c.run({ csms, sim, handle, device, store }),
            c.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            c.id,
        );
    } finally {
        sim.stop();
        // Give pending OCPP CALLs a microtask to settle so the SQLite
        // handle isn't yanked from under them.
        await sleep(50);
        store.close();
        await csms.stop();
    }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withTimeout<T>(p: Promise<T>, ms: number, id: string): Promise<T> {
    return await Promise.race([
        p,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`conformance case ${id} timed out after ${ms}ms`)), ms),
        ),
    ]);
}

/** Per-case result row for `runConformanceSuite`. Plain JSON. */
export interface CaseResult {
    id: string;
    title: string;
    profile: ConformanceCase['profile'];
    /** 'passed' if the case body resolved without throwing within its
     *  timeout, 'failed' otherwise. */
    status: 'passed' | 'failed';
    /** Stringified error from the case body or the timeout watchdog.
     *  Empty when status is 'passed'. */
    error: string | null;
    durationMs: number;
    /** True when the case is part of a profile the simulator hasn't
     *  built yet. The case still ran — these cases typically assert
     *  the simulator's CALLERROR=NotImplemented response, which is
     *  the spec-correct behaviour for unsupported features. The flag
     *  lets renderers tone the row neutrally instead of green so the
     *  operator sees the gap honestly. */
    unimplemented: boolean;
    /** Optional explanation for the unimplemented flag. */
    unimplementedReason: string | null;
}

export interface SuiteResult {
    passed: number;
    failed: number;
    durationMs: number;
    cases: CaseResult[];
}

/**
 * Run a list of conformance cases and return a JSON-shaped report.
 * Unlike `runConformanceCase`, this never throws — failures land in
 * `cases[].error` so callers (REST endpoints, SPA renderers, CI
 * gates) get a single uniform shape regardless of which case blew
 * up.
 *
 * Cases run sequentially. Each spins up its own port-0 CSMS + memory
 * Store internally, so they're isolated even though we don't
 * parallelise — running in series keeps the CSMS port pool small
 * and the log output ordered.
 */
export async function runConformanceSuite(cases: ConformanceCase[]): Promise<SuiteResult> {
    const started = Date.now();
    const results: CaseResult[] = [];
    for (const c of cases) {
        const t0 = Date.now();
        const isUnimpl = Boolean(c.unimplemented);
        const unimplReason = typeof c.unimplemented === 'string' ? c.unimplemented : null;
        try {
            await runConformanceCase(c);
            results.push({
                id: c.id,
                title: c.title,
                profile: c.profile,
                status: 'passed',
                error: null,
                durationMs: Date.now() - t0,
                unimplemented: isUnimpl,
                unimplementedReason: unimplReason,
            });
        } catch (err) {
            results.push({
                id: c.id,
                title: c.title,
                profile: c.profile,
                status: 'failed',
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - t0,
                unimplemented: isUnimpl,
                unimplementedReason: unimplReason,
            });
        }
    }
    return {
        passed: results.filter((r) => r.status === 'passed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        durationMs: Date.now() - started,
        cases: results,
    };
}

function buildDevice(input: Partial<Device> & { id: string; ocppUrl: string }): Device {
    return {
        id: input.id,
        displayName: input.displayName ?? 'Conformance AC',
        type: input.type ?? 'AC',
        model: input.model ?? 'Eveys-22kW-AC',
        vendor: input.vendor ?? 'Eveys',
        firmwareVersion: input.firmwareVersion ?? '1.0.0',
        maxPowerKw: input.maxPowerKw ?? 22,
        ocppUrl: input.ocppUrl,
        phaseMode: input.phaseMode ?? 'balanced',
        acWiring: input.acWiring ?? DEFAULT_AC_WIRING,
        dcProfile: input.dcProfile,
        createdAt: input.createdAt ?? new Date().toISOString(),
    };
}
