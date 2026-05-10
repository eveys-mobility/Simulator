import { z } from 'zod';

export const DeviceTypeSchema = z.enum(['AC', 'DC']);
export type DeviceType = z.infer<typeof DeviceTypeSchema>;

export const PhaseModeSchema = z.enum(['balanced', 'imbalanced', 'single-phase']);
export type PhaseMode = z.infer<typeof PhaseModeSchema>;

/**
 * Physical AC wiring on the EVSE side. Independent of `phaseMode`,
 * which is the *load* split policy used by the simulation.
 *
 *   phases          1 (L1+N) or 3 (L1+L2+L3+N)
 *   nominalVoltageV phase-to-neutral voltage (default 230 V European)
 *   lineToLineV     phase-to-phase voltage (≈ √3 × nominal, default 400 V)
 *   reportLineToLine when true, MeterValues includes L1-L2/L2-L3/L3-L1
 *                    Voltage entries in addition to L1/L2/L3 (L-N).
 */
export const AcWiringSchema = z.object({
    phases: z.union([z.literal(1), z.literal(3)]).default(3),
    nominalVoltageV: z.number().positive().default(230),
    lineToLineV: z.number().positive().default(400),
    reportLineToLine: z.boolean().default(false),
});
export type AcWiring = z.infer<typeof AcWiringSchema>;

export const DEFAULT_AC_WIRING: AcWiring = {
    phases: 3,
    nominalVoltageV: 230,
    lineToLineV: 400,
    reportLineToLine: false,
};

export const DCBatteryProfileSchema = z.object({
    capacityKwh: z.number().positive(),
    chargerMaxKw: z.number().positive(),
    nominalVoltageV: z.number().positive().default(400),
    initialSocPct: z.number().min(0).max(100).default(20),
    targetSocPct: z.number().min(1).max(100).default(80),
    rampUpSeconds: z.number().nonnegative().default(25),
});
export type DCBatteryProfile = z.infer<typeof DCBatteryProfileSchema>;

/**
 * A device is a single physical charging station. AC devices have one
 * connector (Type 2); DC devices have two (CCS). Type is set when the
 * device is provisioned and never changes — every connector inherits
 * it. This is the *only* source of truth for "is this charger AC or
 * DC"; do not derive it from connector state at runtime.
 */
export const DeviceSchema = z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    type: DeviceTypeSchema,
    model: z.string().min(1),
    vendor: z.string().default('Eveys'),
    firmwareVersion: z.string().default('1.0.0'),
    maxPowerKw: z.number().positive(),
    ocppUrl: z.string().url(),
    /**
     * Password for OCPP basic auth on the WS upgrade (OCPP 1.6 §17.4).
     * When set, the client sends `Authorization: Basic base64(deviceId:password)`.
     * Empty/undefined means anonymous — most dev gateways accept that.
     */
    authPassword: z.string().min(1).optional(),
    phaseMode: PhaseModeSchema.default('balanced'),
    acWiring: AcWiringSchema.optional(),
    dcProfile: DCBatteryProfileSchema.optional(),
    createdAt: z.string().datetime(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const ConnectorStatusSchema = z.enum([
    'Available',
    'Preparing',
    'Charging',
    'SuspendedEV',
    'SuspendedEVSE',
    'Finishing',
    'Reserved',
    'Faulted',
    'Unavailable',
]);
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const ConnectorSchema = z.object({
    deviceId: z.string(),
    id: z.number().int().positive(),
    status: ConnectorStatusSchema,
    activeTransactionId: z.number().int().positive().nullable(),
});
export type Connector = z.infer<typeof ConnectorSchema>;

export const SessionStatusSchema = z.enum(['active', 'completed', 'aborted']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
    id: z.number().int().positive(),
    deviceId: z.string(),
    connectorId: z.number().int().positive(),
    transactionId: z.number().int().positive(),
    idTag: z.string(),
    status: SessionStatusSchema,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    endReason: z.string().nullable(),
    energyWh: z.number().nonnegative(),
    peakPowerKw: z.number().nonnegative(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Live tick emitted by the simulation loop, 1 Hz. */
export interface MeterTick {
    deviceId: string;
    connectorId: number;
    powerKw: number;
    energyKwh: number;
    socPct?: number;
}

/**
 * Default device-level config for new devices, keyed by type. The
 * server's `createDevice` merges these onto whatever the caller
 * passes, so the UI can create a device with just `{type}` and get
 * sensible defaults.
 */
export const DEVICE_DEFAULTS: Record<DeviceType, { maxPowerKw: number; model: string }> = {
    AC: { maxPowerKw: 22, model: 'Eveys-22kW-AC' },
    DC: { maxPowerKw: 100, model: 'Eveys-100kW-DC' },
};

export const DEFAULT_DC_PROFILE: DCBatteryProfile = {
    capacityKwh: 60,
    chargerMaxKw: 100,
    nominalVoltageV: 400,
    initialSocPct: 20,
    targetSocPct: 80,
    rampUpSeconds: 25,
};
