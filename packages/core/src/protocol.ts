import { z } from 'zod';

/**
 * OCPP 1.6J wire format. All frames are JSON arrays:
 *
 *   [2, "<id>", "<Action>", { ...payload }]   // CALL  (request)
 *   [3, "<id>", { ...payload }]               // CALLRESULT
 *   [4, "<id>", "<errorCode>", "<desc>", {…}] // CALLERROR
 *
 * IDs are arbitrary unique strings; we use UUIDs.
 */
export const MessageType = {
    CALL: 2,
    CALLRESULT: 3,
    CALLERROR: 4,
} as const;
export type MessageTypeId = (typeof MessageType)[keyof typeof MessageType];

export type CallFrame = [typeof MessageType.CALL, string, string, unknown];
export type CallResultFrame = [typeof MessageType.CALLRESULT, string, unknown];
export type CallErrorFrame = [typeof MessageType.CALLERROR, string, string, string, unknown];
export type Frame = CallFrame | CallResultFrame | CallErrorFrame;

export function encodeCall(id: string, action: string, payload: unknown): string {
    return JSON.stringify([MessageType.CALL, id, action, payload] satisfies CallFrame);
}

export function encodeResult(id: string, payload: unknown): string {
    return JSON.stringify([MessageType.CALLRESULT, id, payload] satisfies CallResultFrame);
}

export function encodeError(
    id: string,
    code: string,
    description: string,
    details: unknown = {},
): string {
    return JSON.stringify([MessageType.CALLERROR, id, code, description, details] satisfies CallErrorFrame);
}

export class ProtocolError extends Error {
    constructor(message: string, readonly raw: string) {
        super(message);
        this.name = 'ProtocolError';
    }
}

export function decodeFrame(raw: string): Frame {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new ProtocolError(`invalid JSON: ${(err as Error).message}`, raw);
    }
    if (!Array.isArray(parsed) || parsed.length < 3) {
        throw new ProtocolError('frame must be an array of length >= 3', raw);
    }
    const [tid] = parsed;
    if (tid === MessageType.CALL && parsed.length === 4 && typeof parsed[1] === 'string' && typeof parsed[2] === 'string') {
        return parsed as CallFrame;
    }
    if (tid === MessageType.CALLRESULT && parsed.length === 3 && typeof parsed[1] === 'string') {
        return parsed as CallResultFrame;
    }
    if (tid === MessageType.CALLERROR && parsed.length === 5 && typeof parsed[1] === 'string') {
        return parsed as CallErrorFrame;
    }
    throw new ProtocolError(`unrecognized frame shape (tid=${String(tid)})`, raw);
}

// ---- Payload schemas (subset — what the simulator actually sends/receives) ----

export const BootNotificationReqSchema = z.object({
    chargePointVendor: z.string().max(20),
    chargePointModel: z.string().max(20),
    chargePointSerialNumber: z.string().max(25).optional(),
    firmwareVersion: z.string().max(50).optional(),
    iccid: z.string().max(20).optional(),
    imsi: z.string().max(20).optional(),
    meterType: z.string().max(25).optional(),
    meterSerialNumber: z.string().max(25).optional(),
});
export type BootNotificationReq = z.infer<typeof BootNotificationReqSchema>;

export const BootNotificationResSchema = z.object({
    status: z.enum(['Accepted', 'Pending', 'Rejected']),
    currentTime: z.string(),
    interval: z.number().int().nonnegative(),
});
export type BootNotificationRes = z.infer<typeof BootNotificationResSchema>;

export const StatusNotificationReqSchema = z.object({
    connectorId: z.number().int().nonnegative(),
    errorCode: z.enum([
        'ConnectorLockFailure',
        'EVCommunicationError',
        'GroundFailure',
        'HighTemperature',
        'InternalError',
        'LocalListConflict',
        'NoError',
        'OtherError',
        'OverCurrentFailure',
        'PowerMeterFailure',
        'PowerSwitchFailure',
        'ReaderFailure',
        'ResetFailure',
        'UnderVoltage',
        'OverVoltage',
        'WeakSignal',
    ]),
    status: z.enum([
        'Available',
        'Preparing',
        'Charging',
        'SuspendedEVSE',
        'SuspendedEV',
        'Finishing',
        'Reserved',
        'Unavailable',
        'Faulted',
    ]),
    timestamp: z.string().datetime().optional(),
    info: z.string().max(50).optional(),
    vendorId: z.string().max(255).optional(),
    vendorErrorCode: z.string().max(50).optional(),
});
export type StatusNotificationReq = z.infer<typeof StatusNotificationReqSchema>;

export const HeartbeatReqSchema = z.object({}).strict();
export type HeartbeatReq = z.infer<typeof HeartbeatReqSchema>;

export const HeartbeatResSchema = z.object({ currentTime: z.string() });
export type HeartbeatRes = z.infer<typeof HeartbeatResSchema>;

export const AuthorizeReqSchema = z.object({
    idTag: z.string().min(1).max(20),
});

export const AuthorizeResSchema = z.object({
    idTagInfo: z.object({
        status: z.enum(['Accepted', 'Blocked', 'Expired', 'Invalid', 'ConcurrentTx']),
        expiryDate: z.string().optional(),
        parentIdTag: z.string().optional(),
    }),
});
export type AuthorizeRes = z.infer<typeof AuthorizeResSchema>;

export const StartTransactionReqSchema = z.object({
    connectorId: z.number().int().positive(),
    idTag: z.string().min(1).max(20),
    meterStart: z.number().int().nonnegative(),
    timestamp: z.string().datetime(),
    reservationId: z.number().int().optional(),
});

// Spec requires integer transactionId. Some CSMS implementations (e.g.
// Toger / OCPI bridge flows) keep their internal Transaction identifier
// as a UUID and put it on the wire as a string. Accept either so this
// simulator can interop with relaxed real-world CSMS without forcing
// every Toger-style integration to refactor their identifier model.
export const StartTransactionResSchema = z.object({
    transactionId: z.union([z.number().int(), z.string().min(1)]),
    idTagInfo: AuthorizeResSchema.shape.idTagInfo,
});
export type StartTransactionRes = z.infer<typeof StartTransactionResSchema>;

export const StopTransactionReqSchema = z.object({
    transactionId: z.union([z.number().int(), z.string().min(1)]),
    idTag: z.string().optional(),
    meterStop: z.number().int().nonnegative(),
    timestamp: z.string().datetime(),
    reason: z.enum([
        'EmergencyStop',
        'EVDisconnected',
        'HardReset',
        'Local',
        'Other',
        'PowerLoss',
        'Reboot',
        'Remote',
        'SoftReset',
        'UnlockCommand',
        'DeAuthorized',
    ]).optional(),
    transactionData: z.array(z.unknown()).optional(),
});

export const SampledValueSchema = z.object({
    value: z.string(),
    context: z.string().optional(),
    format: z.enum(['Raw', 'SignedData']).optional(),
    measurand: z.string().optional(),
    phase: z.string().optional(),
    location: z.string().optional(),
    unit: z.string().optional(),
});

export const MeterValueReqSchema = z.object({
    connectorId: z.number().int().positive(),
    transactionId: z.union([z.number().int(), z.string().min(1)]).optional(),
    meterValue: z.array(
        z.object({
            timestamp: z.string().datetime(),
            sampledValue: z.array(SampledValueSchema),
        }),
    ),
});
