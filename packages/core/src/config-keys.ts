/**
 * OCPP 1.6 standard configuration keys. Subset chosen for the
 * simulator's needs — full table is in OCPP 1.6 Edition 2 §9.1.
 *
 * Each key has:
 *  - `type`        for parsing the string value the CSMS sends
 *  - `readonly`    whether the CSMS may write it
 *  - `rebootRequired` whether the change takes effect only after reboot
 *  - `default`     stringified default value
 *
 * Strings, ints, bools, and CSL (comma-separated list) are the four
 * value types OCPP 1.6 actually uses. Everything is on the wire as
 * a string.
 */
export type ConfigValueType = 'string' | 'int' | 'bool' | 'csl';

export interface ConfigKeySpec {
    key: string;
    type: ConfigValueType;
    readonly: boolean;
    rebootRequired: boolean;
    default: string;
    /** Short human note — surfaced in tooling, never sent to the CSMS. */
    description?: string;
}

/**
 * Descriptions are short and operator-facing. They paraphrase the
 * OCPP 1.6 §9.1 wording, not quote it — the goal is "I can decide
 * whether to flip this without the spec open" rather than legal
 * compliance with the standard's prose.
 */
export const STANDARD_CONFIG_KEYS: ConfigKeySpec[] = [
    // Core
    {
        key: 'AllowOfflineTxForUnknownId',
        type: 'bool',
        readonly: false,
        rebootRequired: false,
        default: 'false',
        description:
            'When the CSMS is unreachable, allow charging an idTag the local cache has never seen.',
    },
    {
        key: 'AuthorizationCacheEnabled',
        type: 'bool',
        readonly: false,
        rebootRequired: false,
        default: 'true',
        description: 'Cache idTag authorizations locally so previously-Accepted tags work offline.',
    },
    {
        key: 'AuthorizeRemoteTxRequests',
        type: 'bool',
        readonly: false,
        rebootRequired: false,
        default: 'false',
        description:
            'Send Authorize before honoring a CSMS-initiated RemoteStartTransaction. Off = trust the CSMS.',
    },
    {
        key: 'BlinkRepeat',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '0',
        description: 'Times the LED repeats its blink pattern (vendor-specific). 0 = no repeat.',
    },
    {
        key: 'ClockAlignedDataInterval',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '0',
        description:
            'Cadence (s) of clock-aligned MeterValues, sent on wall-clock boundaries. 0 disables.',
    },
    {
        key: 'ConnectionTimeOut',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '60',
        description:
            'Seconds in Preparing before reverting to Available when no plug-in / authorize follows.',
    },
    {
        key: 'ConnectorPhaseRotation',
        type: 'csl',
        readonly: false,
        rebootRequired: false,
        default: 'Unknown',
        description:
            'Phase wiring per connector. Comma-separated entries like "1.RST, 2.RTS"; "Unknown" if not configured.',
    },
    {
        key: 'ConnectorPhaseRotationMaxLength',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '8',
        description: 'Max number of entries the CP accepts in ConnectorPhaseRotation.',
    },
    {
        key: 'GetConfigurationMaxKeys',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '50',
        description: 'Max keys the CP returns in a single GetConfiguration response.',
    },
    {
        key: 'HeartbeatInterval',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '60',
        description:
            'Seconds between Heartbeat messages while no other traffic is on the wire. The CSMS may override.',
    },
    {
        key: 'LightIntensity',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '100',
        description: 'Connector / display LED intensity (0–100). Vendor-specific.',
    },
    {
        key: 'LocalAuthorizeOffline',
        type: 'bool',
        readonly: false,
        rebootRequired: false,
        default: 'true',
        description: 'Use the local authorization list / cache when the CSMS is unreachable.',
    },
    {
        key: 'LocalPreAuthorize',
        type: 'bool',
        readonly: false,
        rebootRequired: false,
        default: 'false',
        description:
            'Authorize from the local cache before contacting the CSMS — speeds up plug-in but may green-light a revoked tag.',
    },
    {
        key: 'MaxEnergyOnInvalidId',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '0',
        description:
            'Max Wh delivered after StopTransactionOnInvalidId triggers, before the connector cuts power. 0 = stop immediately.',
    },
    {
        key: 'MeterValuesAlignedData',
        type: 'csl',
        readonly: false,
        rebootRequired: false,
        default: 'Energy.Active.Import.Register',
        description: 'Measurands included in clock-aligned MeterValues frames.',
    },
    {
        key: 'MeterValuesAlignedDataMaxLength',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '4',
        description: 'Max measurands the CP accepts in MeterValuesAlignedData.',
    },
    {
        key: 'MeterValuesSampledData',
        type: 'csl',
        readonly: false,
        rebootRequired: false,
        default: 'Energy.Active.Import.Register,Power.Active.Import',
        description:
            'Measurands included in per-session MeterValues frames (the live charging stream).',
    },
    {
        key: 'MeterValuesSampledDataMaxLength',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '4',
        description: 'Max measurands the CP accepts in MeterValuesSampledData.',
    },
    {
        key: 'MeterValueSampleInterval',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '60',
        description:
            'Seconds between MeterValues frames during an active session. Set lower for finer telemetry.',
    },
    {
        key: 'MinimumStatusDuration',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '0',
        description:
            'Minimum seconds a transient status (e.g. Preparing) must hold before being reported.',
    },
    {
        key: 'NumberOfConnectors',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '1',
        description:
            'Physical connector count on this charge point. Read-only — derived from hardware.',
    },
    {
        key: 'ResetRetries',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '1',
        description: 'Times the CP retries a Reset that initially fails.',
    },
    {
        key: 'StopTransactionOnEVSideDisconnect',
        type: 'bool',
        readonly: false,
        rebootRequired: false,
        default: 'true',
        description:
            'Auto-stop the transaction when the cable is unplugged. Off = stay in SuspendedEV waiting for re-plug.',
    },
    {
        key: 'StopTransactionOnInvalidId',
        type: 'bool',
        readonly: false,
        rebootRequired: false,
        default: 'true',
        description:
            'Stop the active transaction if the CSMS later marks the idTag invalid (revocation mid-charge).',
    },
    {
        key: 'StopTxnAlignedData',
        type: 'csl',
        readonly: false,
        rebootRequired: false,
        default: 'Energy.Active.Import.Register',
        description:
            'Measurands attached to StopTransaction transactionData on clock-aligned ticks.',
    },
    {
        key: 'StopTxnAlignedDataMaxLength',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '4',
        description: 'Max measurands the CP accepts in StopTxnAlignedData.',
    },
    {
        key: 'StopTxnSampledData',
        type: 'csl',
        readonly: false,
        rebootRequired: false,
        default: 'Energy.Active.Import.Register',
        description: 'Measurands attached to StopTransaction transactionData on per-sample ticks.',
    },
    {
        key: 'StopTxnSampledDataMaxLength',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '4',
        description: 'Max measurands the CP accepts in StopTxnSampledData.',
    },
    {
        key: 'SupportedFeatureProfiles',
        type: 'csl',
        readonly: true,
        rebootRequired: false,
        default:
            'Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger',
        description: 'OCPP 1.6 profiles this CP implements. Read-only — set by the firmware build.',
    },
    {
        key: 'SupportedFeatureProfilesMaxLength',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '6',
        description: 'Max number of profiles the CP can advertise.',
    },
    {
        key: 'TransactionMessageAttempts',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '3',
        description:
            'Times the CP retries a transaction-related message (StartTransaction, StopTransaction, MeterValues) on failure.',
    },
    {
        key: 'TransactionMessageRetryInterval',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '60',
        description:
            'Seconds between transaction-message retries. The CP may apply exponential backoff on top.',
    },
    {
        key: 'UnlockConnectorOnEVSideDisconnect',
        type: 'bool',
        readonly: false,
        rebootRequired: false,
        default: 'true',
        description: 'Release the cable lock when the EV side disconnects mid-session.',
    },
    {
        key: 'WebSocketPingInterval',
        type: 'int',
        readonly: false,
        rebootRequired: false,
        default: '0',
        description:
            'Seconds between WS-level ping frames. 0 disables; useful through aggressive NATs.',
    },

    // LocalAuthListManagement
    {
        key: 'LocalAuthListEnabled',
        type: 'bool',
        readonly: false,
        rebootRequired: false,
        default: 'true',
        description: 'Honor the locally-stored authorization list when authorizing idTags.',
    },
    {
        key: 'LocalAuthListMaxLength',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '1000',
        description: 'Maximum entries the CP will store in the local authorization list.',
    },
    {
        key: 'SendLocalListMaxLength',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '100',
        description: 'Maximum entries the CP accepts in a single SendLocalList payload.',
    },

    // Reservation
    {
        key: 'ReserveConnectorZeroSupported',
        type: 'bool',
        readonly: true,
        rebootRequired: false,
        default: 'true',
        description:
            'Whether the CP accepts ReserveNow targeting connectorId=0 (the device, any free connector).',
    },

    // SmartCharging
    {
        key: 'ChargeProfileMaxStackLevel',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '3',
        description: 'Highest stackLevel the CP supports across SetChargingProfile installations.',
    },
    {
        key: 'ChargingScheduleAllowedChargingRateUnit',
        type: 'csl',
        readonly: true,
        rebootRequired: false,
        default: 'Current,Power',
        description:
            'chargingRateUnit values the CP accepts in a charging profile (Current=A, Power=W).',
    },
    {
        key: 'ChargingScheduleMaxPeriods',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '24',
        description: 'Maximum chargingSchedulePeriod entries within one chargingSchedule.',
    },
    {
        key: 'MaxChargingProfilesInstalled',
        type: 'int',
        readonly: true,
        rebootRequired: false,
        default: '8',
        description:
            'Total charging profiles the CP can hold across all connectors and purposes combined.',
    },
];

export const CONFIG_KEY_INDEX: Map<string, ConfigKeySpec> = new Map(
    STANDARD_CONFIG_KEYS.map((k) => [k.key, k]),
);

/**
 * Validate a stringified value against the spec's declared type.
 * Returns null if valid, or an error reason for the CSMS.
 */
export function validateConfigValue(spec: ConfigKeySpec, value: string): string | null {
    switch (spec.type) {
        case 'int': {
            const n = Number(value);
            if (!Number.isInteger(n)) return `${spec.key} must be an integer`;
            return null;
        }
        case 'bool':
            if (value !== 'true' && value !== 'false')
                return `${spec.key} must be 'true' or 'false'`;
            return null;
        case 'csl':
        case 'string':
            return null;
    }
}

/**
 * Outcome of `ChangeConfiguration` per OCPP 1.6 §6.8:
 *   Accepted        — applied, in effect immediately
 *   Rejected        — value invalid for this key
 *   RebootRequired  — applied, takes effect on next reboot
 *   NotSupported    — unknown key or not supported on this device
 */
export type ChangeConfigStatus = 'Accepted' | 'Rejected' | 'RebootRequired' | 'NotSupported';
