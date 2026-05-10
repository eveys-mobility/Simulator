import type { ConformanceCase } from '../runner.js';

/**
 * OCPP 1.6 Reservation profile cases.
 *
 * The simulator implements the profile (§6.18 ReserveNow, §6.4
 * CancelReservation): a per-connector reservation slot with an
 * expiry timer, status flips to Reserved, and the bound idTag
 * gets exclusive access until expiry / cancel / consumption.
 */
export const RESERVATION_CASES: ConformanceCase[] = [
    {
        id: 'reservation.reserve-now-accepted',
        title: 'ReserveNow on a free connector returns Accepted and flips status to Reserved',
        profile: 'Reservation',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);

            const r = (await handle.rawCall('ReserveNow', {
                connectorId: 1,
                expiryDate: new Date(Date.now() + 60_000).toISOString(),
                idTag: 'TAG-A',
                reservationId: 1,
            })) as { status: string };
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
            await handle.waitForStatus('Reserved', 1);
        },
    },

    {
        id: 'reservation.reserve-occupied-connector-returns-occupied',
        title: 'ReserveNow on a charging connector returns Occupied',
        profile: 'Reservation',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);

            // Drop meter cadence so the test runs fast.
            await handle.changeConfiguration('MeterValueSampleInterval', '60');
            await handle.remoteStart({ connectorId: 1, idTag: 'CHG' });
            await handle.waitForStatus('Charging', 1);

            const r = (await handle.rawCall('ReserveNow', {
                connectorId: 1,
                expiryDate: new Date(Date.now() + 60_000).toISOString(),
                idTag: 'TAG-A',
                reservationId: 5,
            })) as { status: string };
            if (r.status !== 'Occupied') {
                throw new Error(`expected Occupied, got ${r.status}`);
            }
        },
    },

    {
        id: 'reservation.reserve-unavailable-connector-returns-unavailable',
        title: 'ReserveNow on an Inoperative connector returns Unavailable',
        profile: 'Reservation',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);

            const ca = await handle.changeAvailability(1, 'Inoperative');
            if (ca.status !== 'Accepted') {
                throw new Error(`ChangeAvailability Inoperative expected Accepted, got ${ca.status}`);
            }
            await handle.waitForStatus('Unavailable', 1);

            const r = (await handle.rawCall('ReserveNow', {
                connectorId: 1,
                expiryDate: new Date(Date.now() + 60_000).toISOString(),
                idTag: 'TAG-A',
                reservationId: 7,
            })) as { status: string };
            if (r.status !== 'Unavailable') {
                throw new Error(`expected Unavailable, got ${r.status}`);
            }
        },
    },

    {
        id: 'reservation.cancel-by-id-accepted',
        title: 'CancelReservation by id releases the slot and flips back to Available',
        profile: 'Reservation',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.rawCall('ReserveNow', {
                connectorId: 1,
                expiryDate: new Date(Date.now() + 60_000).toISOString(),
                idTag: 'TAG-A',
                reservationId: 11,
            });
            await handle.waitForStatus('Reserved', 1);

            const r = (await handle.rawCall('CancelReservation', { reservationId: 11 })) as {
                status: string;
            };
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
            await handle.waitForStatus('Available', 1);
        },
    },

    {
        id: 'reservation.cancel-unknown-id-rejected',
        title: 'CancelReservation with an unknown id returns Rejected',
        profile: 'Reservation',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = (await handle.rawCall('CancelReservation', { reservationId: 999 })) as {
                status: string;
            };
            if (r.status !== 'Rejected') {
                throw new Error(`expected Rejected, got ${r.status}`);
            }
        },
    },

    {
        id: 'reservation.matching-tag-consumes-and-charges',
        title: 'RemoteStart with the reserved idTag consumes the reservation and charges',
        profile: 'Reservation',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.rawCall('ReserveNow', {
                connectorId: 1,
                expiryDate: new Date(Date.now() + 60_000).toISOString(),
                idTag: 'TAG-RIGHT',
                reservationId: 21,
            });
            await handle.waitForStatus('Reserved', 1);
            await handle.changeConfiguration('MeterValueSampleInterval', '60');

            const r = await handle.remoteStart({ connectorId: 1, idTag: 'TAG-RIGHT' });
            if (r.status !== 'Accepted') {
                throw new Error(`RemoteStart with reserved idTag expected Accepted, got ${r.status}`);
            }
            await handle.waitForStatus('Charging', 1);
        },
    },

    {
        id: 'reservation.wrong-tag-rejected',
        title: 'RemoteStart with a non-reserved idTag is Rejected on a Reserved connector',
        profile: 'Reservation',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.rawCall('ReserveNow', {
                connectorId: 1,
                expiryDate: new Date(Date.now() + 60_000).toISOString(),
                idTag: 'TAG-RESERVED',
                reservationId: 31,
            });
            await handle.waitForStatus('Reserved', 1);

            const r = await handle.remoteStart({ connectorId: 1, idTag: 'TAG-OTHER' });
            if (r.status !== 'Rejected') {
                throw new Error(
                    `RemoteStart with wrong idTag expected Rejected, got ${r.status}`,
                );
            }
        },
    },
];
