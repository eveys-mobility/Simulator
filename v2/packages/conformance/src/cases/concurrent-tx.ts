import type { ConformanceCase } from '../runner.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * OCPP 1.6 §5.5 ConcurrentTx semantics. The same idTag can hold at
 * most one active transaction at a time on a charge point. A second
 * RemoteStart for an already-charging tag must be refused before
 * any StartTransaction CALL goes out.
 *
 * The cases use a 2-connector DC device so two RemoteStart attempts
 * have somewhere to land — the negative path then proves the second
 * lands as Rejected.
 */
export const CONCURRENT_TX_CASES: ConformanceCase[] = [
    {
        id: 'core.concurrent-tx.same-tag-second-session-rejected',
        title: 'RemoteStart for an idTag already in a session → Rejected (no StartTransaction follows)',
        profile: 'Core',
        deviceOverrides: { type: 'DC', maxPowerKw: 100, model: 'Eveys-100kW-DC' },
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.waitForStatus('Available', 2);
            await handle.changeConfiguration('MeterValueSampleInterval', '60');

            // First session on connector 1.
            const first = await handle.remoteStart({ connectorId: 1, idTag: 'TAG-X' });
            if (first.status !== 'Accepted') {
                throw new Error(`first RemoteStart expected Accepted, got ${first.status}`);
            }
            await handle.waitForStatus('Charging', 1);

            // Count StartTransaction CALLs *after* the first session is
            // charging — the second RemoteStart must not produce another.
            const startCountBefore = handle
                .framesFor('StartTransaction')
                .filter((f) => f.direction === 'in').length;

            const second = await handle.remoteStart({ connectorId: 2, idTag: 'TAG-X' });
            if (second.status !== 'Rejected') {
                throw new Error(
                    `second RemoteStart with same idTag expected Rejected, got ${second.status}`,
                );
            }
            await sleep(200);
            const startCountAfter = handle
                .framesFor('StartTransaction')
                .filter((f) => f.direction === 'in').length;
            if (startCountAfter !== startCountBefore) {
                throw new Error(
                    `second RemoteStart should not emit StartTransaction; saw ${startCountAfter - startCountBefore} extra`,
                );
            }
        },
    },

    {
        id: 'core.concurrent-tx.different-tags-allowed',
        title: 'Different idTags can run concurrent sessions on different connectors',
        profile: 'Core',
        deviceOverrides: { type: 'DC', maxPowerKw: 100, model: 'Eveys-100kW-DC' },
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.waitForStatus('Available', 2);
            await handle.changeConfiguration('MeterValueSampleInterval', '60');

            const a = await handle.remoteStart({ connectorId: 1, idTag: 'TAG-A' });
            if (a.status !== 'Accepted') {
                throw new Error(`first session expected Accepted, got ${a.status}`);
            }
            await handle.waitForStatus('Charging', 1);

            const b = await handle.remoteStart({ connectorId: 2, idTag: 'TAG-B' });
            if (b.status !== 'Accepted') {
                throw new Error(
                    `concurrent session under a different idTag expected Accepted, got ${b.status}`,
                );
            }
            await handle.waitForStatus('Charging', 2);
        },
    },

    {
        id: 'core.concurrent-tx.tag-reusable-after-stop',
        title: 'After the first session ends, the same idTag can start again',
        profile: 'Core',
        deviceOverrides: { type: 'DC', maxPowerKw: 100, model: 'Eveys-100kW-DC' },
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.waitForStatus('Available', 2);
            await handle.changeConfiguration('MeterValueSampleInterval', '60');

            await handle.remoteStart({ connectorId: 1, idTag: 'TAG-RECYCLE' });
            await handle.waitForStatus('Charging', 1);
            // The transactionId comes back on the CALLRESULT (the
            // CSMS → CP direction) — the CALL itself doesn't carry it.
            // Wait briefly for the result frame, then read it.
            let txId: number | undefined;
            const deadline = Date.now() + 1500;
            while (Date.now() < deadline && txId === undefined) {
                const result = handle
                    .framesFor('StartTransaction')
                    .find((f) => f.type === 'CALLRESULT');
                if (result) {
                    txId = (result.payload as { transactionId?: number }).transactionId;
                }
                if (txId === undefined) await sleep(50);
            }
            if (txId === undefined) {
                throw new Error('StartTransaction CALLRESULT never landed; no transactionId');
            }

            // Snapshot the StatusNotification count *before* the stop
            // so we wait for a *new* Available frame, not the one the
            // device emitted at boot. waitForStatus returns the first
            // match in the buffer, which would race past the post-stop
            // signal otherwise.
            const statusBefore = handle
                .framesFor('StatusNotification')
                .filter(
                    (f) =>
                        f.direction === 'in' &&
                        f.type === 'CALL' &&
                        (f.payload as { connectorId?: number }).connectorId === 1,
                ).length;

            // End the first session via RemoteStop.
            const stop = await handle.remoteStop(txId);
            if (stop.status !== 'Accepted') {
                throw new Error(`RemoteStop expected Accepted, got ${stop.status}`);
            }

            // Wait until the connector emits a fresh StatusNotification
            // *after* the stop — that's the Available that signals the
            // tick chain (idTag null, transactionId null) is complete.
            const stopDeadline = Date.now() + 3000;
            while (Date.now() < stopDeadline) {
                const c1Frames = handle
                    .framesFor('StatusNotification')
                    .filter(
                        (f) =>
                            f.direction === 'in' &&
                            f.type === 'CALL' &&
                            (f.payload as { connectorId?: number }).connectorId === 1,
                    );
                if (c1Frames.length > statusBefore) {
                    const last = c1Frames[c1Frames.length - 1];
                    if ((last?.payload as { status?: string }).status === 'Available') break;
                }
                await sleep(50);
            }

            // The same idTag should now be free to start again.
            const second = await handle.remoteStart({ connectorId: 2, idTag: 'TAG-RECYCLE' });
            if (second.status !== 'Accepted') {
                throw new Error(
                    `re-using the idTag after stop expected Accepted, got ${second.status}`,
                );
            }
            await handle.waitForStatus('Charging', 2);
        },
    },
];
