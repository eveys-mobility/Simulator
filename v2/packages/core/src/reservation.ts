import { z } from 'zod';

/**
 * OCPP 1.6 Reservation profile (§6.18, §6.4) — wire shapes for
 * ReserveNow / CancelReservation. The CSMS reserves a connector for
 * a specific idTag until expiryDate; when that idTag swipes /
 * RemoteStart fires, the simulator consumes the reservation and
 * starts the session normally.
 */

/** ReserveNow response status (§6.18). */
export const ReserveNowStatus = z.enum([
    /** Reservation accepted and stored. */
    'Accepted',
    /** Connector or charge point is in a Faulted state. */
    'Faulted',
    /** Connector is currently occupied (Charging / Preparing / Finishing). */
    'Occupied',
    /** Reservation rejected for any other reason (e.g. duplicate id). */
    'Rejected',
    /** Connector is Unavailable (operator marked Inoperative). */
    'Unavailable',
]);
export type ReserveNowStatus = z.infer<typeof ReserveNowStatus>;

/** CancelReservation response status (§6.4). */
export const CancelReservationStatus = z.enum(['Accepted', 'Rejected']);
export type CancelReservationStatus = z.infer<typeof CancelReservationStatus>;

export const ReserveNowReqSchema = z.object({
    /** Target connector. 0 means "any free connector on the device". */
    connectorId: z.number().int().nonnegative(),
    /** When the reservation expires. After this point the connector is
     *  released and the simulator emits StatusNotification Available. */
    expiryDate: z.string().datetime(),
    /** idTag the reservation is bound to — only this tag can consume it. */
    idTag: z.string().min(1),
    /** Unique-per-charge-point id used by the CSMS to refer to the
     *  reservation later (CancelReservation, audit). */
    reservationId: z.number().int(),
    /** Optional parent idTag for groups; the simulator stores it but
     *  doesn't use it for matching. */
    parentIdTag: z.string().optional(),
});
export type ReserveNowReq = z.infer<typeof ReserveNowReqSchema>;

export const CancelReservationReqSchema = z.object({
    reservationId: z.number().int(),
});
export type CancelReservationReq = z.infer<typeof CancelReservationReqSchema>;

/** In-memory shape stored per connector. Not on the wire. */
export interface Reservation {
    reservationId: number;
    connectorId: number;
    idTag: string;
    parentIdTag?: string;
    expiryMs: number;
}
