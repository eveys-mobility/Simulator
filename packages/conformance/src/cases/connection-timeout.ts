import type { ConformanceCase } from '../runner.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * OCPP 1.6 §9.1.5 ConnectionTimeOut. When a connector enters
 * Preparing and no plug-in / session start follows within
 * ConnectionTimeOut seconds, the CP must revert to Available.
 *
 * Cases shrink the window via ChangeConfiguration so the suite
 * stays fast. Default is 60s — too long to wait in CI.
 */
export const CONNECTION_TIMEOUT_CASES: ConformanceCase[] = [
    {
        id: 'core.connection-timeout.preparing-reverts-to-available',
        title: 'Preparing without follow-up reverts to Available after ConnectionTimeOut',
        profile: 'Core',
        run: async ({ handle, sim }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            // Drop the window to 1s so the test isn't slow.
            const cfg = await handle.changeConfiguration('ConnectionTimeOut', '1');
            if (cfg.status !== 'Accepted') {
                throw new Error(
                    `ChangeConfiguration ConnectionTimeOut=1 expected Accepted, got ${cfg.status}`,
                );
            }

            // Snapshot the current StatusNotification frame count so we
            // can wait for *new* status events after triggering Preparing,
            // rather than racing past the boot-time Available frame.
            const beforeCount = handle
                .framesFor('StatusNotification')
                .filter(
                    (f) =>
                        f.direction === 'in' &&
                        f.type === 'CALL' &&
                        (f.payload as { connectorId?: number }).connectorId === 1,
                ).length;

            // Simulate plug-in to enter Preparing. The Simulator's
            // public plugIn() is exposed for direct test drive.
            await sim.plugIn(1);

            // Wait for the Preparing → (timeout) → Available walk.
            // Two new frames expected: Preparing then Available.
            const deadline = Date.now() + 4000;
            let preparingSeen = false;
            let availableAfter = false;
            while (Date.now() < deadline && !availableAfter) {
                const c1 = handle
                    .framesFor('StatusNotification')
                    .filter(
                        (f) =>
                            f.direction === 'in' &&
                            f.type === 'CALL' &&
                            (f.payload as { connectorId?: number }).connectorId === 1,
                    );
                const fresh = c1.slice(beforeCount);
                preparingSeen =
                    preparingSeen ||
                    fresh.some((f) => (f.payload as { status?: string }).status === 'Preparing');
                if (preparingSeen) {
                    // Look for Available *after* the Preparing frame.
                    const prepIdx = fresh.findIndex(
                        (f) => (f.payload as { status?: string }).status === 'Preparing',
                    );
                    availableAfter = fresh
                        .slice(prepIdx + 1)
                        .some((f) => (f.payload as { status?: string }).status === 'Available');
                }
                if (!availableAfter) await sleep(50);
            }
            if (!preparingSeen) throw new Error('connector never reported Preparing');
            if (!availableAfter) {
                throw new Error(
                    'Preparing did not revert to Available within 4s of ConnectionTimeOut=1',
                );
            }
        },
    },

    {
        id: 'core.connection-timeout.zero-disables-watchdog',
        title: 'ConnectionTimeOut=0 disables the watchdog — connector stays in Preparing',
        profile: 'Core',
        run: async ({ handle, sim }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            // 0 means "no timeout" per §9.1.5 / spec convention. The
            // CP should leave the connector in Preparing indefinitely.
            await handle.changeConfiguration('ConnectionTimeOut', '0');

            const beforeCount = handle
                .framesFor('StatusNotification')
                .filter(
                    (f) =>
                        f.direction === 'in' &&
                        f.type === 'CALL' &&
                        (f.payload as { connectorId?: number }).connectorId === 1,
                ).length;

            await sim.plugIn(1);
            // Wait long enough that a 1s timeout would have fired.
            await sleep(1500);

            const c1 = handle
                .framesFor('StatusNotification')
                .filter(
                    (f) =>
                        f.direction === 'in' &&
                        f.type === 'CALL' &&
                        (f.payload as { connectorId?: number }).connectorId === 1,
                );
            const fresh = c1.slice(beforeCount);
            // Should see Preparing but no follow-up Available.
            const reverted = fresh
                .map((f) => (f.payload as { status?: string }).status)
                .filter((s, i, arr) => i > arr.findIndex((x) => x === 'Preparing'))
                .includes('Available');
            if (reverted) {
                throw new Error('connector reverted to Available despite ConnectionTimeOut=0');
            }
        },
    },

    {
        id: 'core.connection-timeout.session-start-cancels',
        title: 'Starting a session before the timeout cancels the watchdog',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.changeConfiguration('ConnectionTimeOut', '1');
            await handle.changeConfiguration('MeterValueSampleInterval', '60');

            await handle.remoteStart({ connectorId: 1, idTag: 'TIMER-NOPE' });
            await handle.waitForStatus('Charging', 1);

            // The timeout would have fired ~1s after Preparing. Wait
            // 1.5s and confirm we're still Charging — no revert frame.
            const beforeCount = handle
                .framesFor('StatusNotification')
                .filter(
                    (f) =>
                        f.direction === 'in' &&
                        f.type === 'CALL' &&
                        (f.payload as { connectorId?: number }).connectorId === 1,
                ).length;
            await sleep(1500);
            const after = handle
                .framesFor('StatusNotification')
                .filter(
                    (f) =>
                        f.direction === 'in' &&
                        f.type === 'CALL' &&
                        (f.payload as { connectorId?: number }).connectorId === 1,
                )
                .slice(beforeCount);
            const revertedToAvailable = after.some(
                (f) => (f.payload as { status?: string }).status === 'Available',
            );
            if (revertedToAvailable) {
                throw new Error(
                    'connector reverted to Available during a charging session — timeout was not cancelled',
                );
            }
        },
    },
];
