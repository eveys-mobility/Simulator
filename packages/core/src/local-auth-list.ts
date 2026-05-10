import { z } from 'zod';

/**
 * OCPP 1.6 LocalAuthListManagement profile (§6.20 SendLocalList,
 * §6.13 GetLocalListVersion).
 *
 * The CSMS pushes a list of idTags + their authorization status to
 * the charge point so it can authorize swipes without round-tripping
 * to the server. Two update modes:
 *   - Full         → replace the entire list (atomic)
 *   - Differential → upsert / delete entries one by one. The CSMS
 *                    bumps `listVersion`; the CP must reject on a
 *                    version that's not strictly newer.
 *
 * idTagInfo carries the verdict the CP returns when an entry matches:
 *   Accepted | Blocked | Expired | Invalid | ConcurrentTx
 * On a Differential update, an entry without idTagInfo means "delete".
 */

export const AuthorizationStatus = z.enum([
    'Accepted',
    'Blocked',
    'Expired',
    'Invalid',
    'ConcurrentTx',
]);
export type AuthorizationStatus = z.infer<typeof AuthorizationStatus>;

export const IdTagInfoSchema = z.object({
    status: AuthorizationStatus,
    /** Optional UTC ISO-8601 cutoff after which the entry is treated
     *  as Expired regardless of the stored status. */
    expiryDate: z.string().datetime().optional(),
    /** Optional parent tag used to group multiple cards under one user. */
    parentIdTag: z.string().optional(),
});
export type IdTagInfo = z.infer<typeof IdTagInfoSchema>;

/** One local-list entry. Missing `idTagInfo` on a Differential update
 *  means "remove this idTag from the list". */
export const AuthorizationDataSchema = z.object({
    idTag: z.string().min(1),
    idTagInfo: IdTagInfoSchema.optional(),
});
export type AuthorizationData = z.infer<typeof AuthorizationDataSchema>;

export const UpdateType = z.enum(['Full', 'Differential']);
export type UpdateType = z.infer<typeof UpdateType>;

export const SendLocalListReqSchema = z.object({
    listVersion: z.number().int().nonnegative(),
    /** Up to GetConfiguration.SendLocalListMaxLength entries. */
    localAuthorizationList: z.array(AuthorizationDataSchema).optional(),
    updateType: UpdateType,
});
export type SendLocalListReq = z.infer<typeof SendLocalListReqSchema>;

/** SendLocalList response status (§6.20). */
export const UpdateStatus = z.enum([
    /** Update applied; list version bumped. */
    'Accepted',
    /** CP failed to apply (e.g. malformed data, list-too-long). */
    'Failed',
    /** Charge point doesn't support the LocalAuthList. */
    'NotSupported',
    /** Differential update but listVersion isn't strictly newer than
     *  the stored one; CSMS should re-sync via Full. */
    'VersionMismatch',
]);
export type UpdateStatus = z.infer<typeof UpdateStatus>;

export const GetLocalListVersionReqSchema = z.object({});
export type GetLocalListVersionReq = z.infer<typeof GetLocalListVersionReqSchema>;
