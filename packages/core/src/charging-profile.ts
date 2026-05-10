import { z } from 'zod';

/**
 * OCPP 1.6 SmartCharging types — verbatim shapes from §6.31, with
 * a few comments about how the simulator interprets them.
 *
 * Numbers are kept as zod numbers (no string parsing) — the codec
 * already gave us JSON.
 */

export const ChargingRateUnit = z.enum(['A', 'W']);
export type ChargingRateUnit = z.infer<typeof ChargingRateUnit>;

export const ChargingProfilePurpose = z.enum([
    'ChargePointMaxProfile',
    'TxDefaultProfile',
    'TxProfile',
]);
export type ChargingProfilePurpose = z.infer<typeof ChargingProfilePurpose>;

export const ChargingProfileKind = z.enum(['Absolute', 'Recurring', 'Relative']);
export type ChargingProfileKind = z.infer<typeof ChargingProfileKind>;

export const RecurrencyKind = z.enum(['Daily', 'Weekly']);
export type RecurrencyKind = z.infer<typeof RecurrencyKind>;

export const ChargingSchedulePeriodSchema = z.object({
    /** Start of the period, **seconds since the schedule start**. */
    startPeriod: z.number().int().nonnegative(),
    /** Limit in the schedule's chargingRateUnit. */
    limit: z.number().nonnegative(),
    /** Number of phases the limit applies to. Defaults to 3. */
    numberPhases: z.number().int().min(1).max(3).optional(),
});
export type ChargingSchedulePeriod = z.infer<typeof ChargingSchedulePeriodSchema>;

export const ChargingScheduleSchema = z.object({
    /** Total schedule duration in seconds. If omitted, the schedule runs forever. */
    duration: z.number().int().nonnegative().optional(),
    /** ISO 8601 absolute start. Required for Absolute and Recurring kinds. */
    startSchedule: z.string().datetime().optional(),
    chargingRateUnit: ChargingRateUnit,
    chargingSchedulePeriod: z.array(ChargingSchedulePeriodSchema).min(1),
    /** Floor below which the device shouldn't go even if the period
     *  computed limit is lower. */
    minChargingRate: z.number().nonnegative().optional(),
});
export type ChargingSchedule = z.infer<typeof ChargingScheduleSchema>;

export const ChargingProfileSchema = z.object({
    chargingProfileId: z.number().int().positive(),
    /** Required when purpose is TxProfile — pins the profile to a session. */
    transactionId: z.number().int().optional(),
    /** Profiles within the same purpose stack: the highest-stackLevel
     *  valid profile wins. Same level is unspecified per OCPP; we
     *  prefer the latest-set in our resolver. */
    stackLevel: z.number().int().nonnegative(),
    chargingProfilePurpose: ChargingProfilePurpose,
    chargingProfileKind: ChargingProfileKind,
    recurrencyKind: RecurrencyKind.optional(),
    validFrom: z.string().datetime().optional(),
    validTo: z.string().datetime().optional(),
    chargingSchedule: ChargingScheduleSchema,
});
export type ChargingProfile = z.infer<typeof ChargingProfileSchema>;

// ---- CSMS-initiated CALL payloads ----

export const SetChargingProfileReqSchema = z.object({
    /** 0 = applies to entire charge point (only valid for ChargePointMaxProfile). */
    connectorId: z.number().int().nonnegative(),
    csChargingProfiles: ChargingProfileSchema,
});
export type SetChargingProfileReq = z.infer<typeof SetChargingProfileReqSchema>;

export const SetChargingProfileStatus = z.enum(['Accepted', 'Rejected', 'NotSupported']);
export type SetChargingProfileStatus = z.infer<typeof SetChargingProfileStatus>;

export const ClearChargingProfileReqSchema = z.object({
    id: z.number().int().optional(),
    connectorId: z.number().int().nonnegative().optional(),
    chargingProfilePurpose: ChargingProfilePurpose.optional(),
    stackLevel: z.number().int().nonnegative().optional(),
});
export type ClearChargingProfileReq = z.infer<typeof ClearChargingProfileReqSchema>;

export const ClearChargingProfileStatus = z.enum(['Accepted', 'Unknown']);
export type ClearChargingProfileStatus = z.infer<typeof ClearChargingProfileStatus>;

export const GetCompositeScheduleReqSchema = z.object({
    connectorId: z.number().int().nonnegative(),
    duration: z.number().int().positive(),
    chargingRateUnit: ChargingRateUnit.optional(),
});
export type GetCompositeScheduleReq = z.infer<typeof GetCompositeScheduleReqSchema>;

export interface GetCompositeScheduleRes {
    status: 'Accepted' | 'Rejected';
    connectorId?: number;
    scheduleStart?: string;
    chargingSchedule?: ChargingSchedule;
}
