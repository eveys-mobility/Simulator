import type { ConformanceCase } from '../runner.js';

/**
 * OCPP 1.6 Reservation profile cases.
 *
 * The simulator doesn't model reservations yet — `ReserveNow` and
 * `CancelReservation` aren't on the handler list, so the OcppClient's
 * default arm answers with a CALLERROR `NotImplemented`. That's the
 * spec-correct response for an unsupported feature (§1.4) — the
 * cases below assert that, so a CSMS using the simulator gets a clean
 * "no, but I told you politely" rather than a silent timeout.
 *
 * Marked `unimplemented` so the SPA can tone the rows neutrally and
 * the operator sees the gap as expected, not as a bug.
 */
export const RESERVATION_CASES: ConformanceCase[] = [
    {
        id: 'reservation.reserve-now-not-implemented',
        title: 'ReserveNow returns NotImplemented (feature not modelled)',
        profile: 'Reservation',
        unimplemented: 'Reservation profile not built yet — simulator answers NotImplemented per §1.4',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            try {
                await handle.rawCall('ReserveNow', {
                    connectorId: 1,
                    expiryDate: new Date(Date.now() + 60_000).toISOString(),
                    idTag: 'TAG',
                    reservationId: 1,
                });
                throw new Error('expected NotImplemented CALLERROR, got CALLRESULT');
            } catch (err) {
                const m = err instanceof Error ? err.message : String(err);
                if (!m.startsWith('NotImplemented:')) {
                    throw new Error(`expected "NotImplemented: ..." error, got "${m}"`);
                }
            }
        },
    },

    {
        id: 'reservation.cancel-reservation-not-implemented',
        title: 'CancelReservation returns NotImplemented (feature not modelled)',
        profile: 'Reservation',
        unimplemented: 'Reservation profile not built yet — simulator answers NotImplemented per §1.4',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            try {
                await handle.rawCall('CancelReservation', { reservationId: 1 });
                throw new Error('expected NotImplemented CALLERROR, got CALLRESULT');
            } catch (err) {
                const m = err instanceof Error ? err.message : String(err);
                if (!m.startsWith('NotImplemented:')) {
                    throw new Error(`expected "NotImplemented: ..." error, got "${m}"`);
                }
            }
        },
    },
];
