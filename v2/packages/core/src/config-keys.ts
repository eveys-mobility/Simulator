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

export const STANDARD_CONFIG_KEYS: ConfigKeySpec[] = [
    // Core
    { key: 'AllowOfflineTxForUnknownId', type: 'bool', readonly: false, rebootRequired: false, default: 'false' },
    { key: 'AuthorizationCacheEnabled', type: 'bool', readonly: false, rebootRequired: false, default: 'true' },
    { key: 'AuthorizeRemoteTxRequests', type: 'bool', readonly: false, rebootRequired: false, default: 'false' },
    { key: 'BlinkRepeat', type: 'int', readonly: false, rebootRequired: false, default: '0' },
    { key: 'ClockAlignedDataInterval', type: 'int', readonly: false, rebootRequired: false, default: '0' },
    { key: 'ConnectionTimeOut', type: 'int', readonly: false, rebootRequired: false, default: '60' },
    { key: 'ConnectorPhaseRotation', type: 'csl', readonly: false, rebootRequired: false, default: 'Unknown' },
    { key: 'ConnectorPhaseRotationMaxLength', type: 'int', readonly: true, rebootRequired: false, default: '8' },
    { key: 'GetConfigurationMaxKeys', type: 'int', readonly: true, rebootRequired: false, default: '50' },
    { key: 'HeartbeatInterval', type: 'int', readonly: false, rebootRequired: false, default: '300' },
    { key: 'LightIntensity', type: 'int', readonly: false, rebootRequired: false, default: '100' },
    { key: 'LocalAuthorizeOffline', type: 'bool', readonly: false, rebootRequired: false, default: 'true' },
    { key: 'LocalPreAuthorize', type: 'bool', readonly: false, rebootRequired: false, default: 'false' },
    { key: 'MaxEnergyOnInvalidId', type: 'int', readonly: false, rebootRequired: false, default: '0' },
    {
        key: 'MeterValuesAlignedData',
        type: 'csl',
        readonly: false,
        rebootRequired: false,
        default: 'Energy.Active.Import.Register',
    },
    { key: 'MeterValuesAlignedDataMaxLength', type: 'int', readonly: true, rebootRequired: false, default: '4' },
    {
        key: 'MeterValuesSampledData',
        type: 'csl',
        readonly: false,
        rebootRequired: false,
        default: 'Energy.Active.Import.Register,Power.Active.Import',
    },
    { key: 'MeterValuesSampledDataMaxLength', type: 'int', readonly: true, rebootRequired: false, default: '4' },
    { key: 'MeterValueSampleInterval', type: 'int', readonly: false, rebootRequired: false, default: '60' },
    { key: 'MinimumStatusDuration', type: 'int', readonly: false, rebootRequired: false, default: '0' },
    { key: 'NumberOfConnectors', type: 'int', readonly: true, rebootRequired: false, default: '1' },
    { key: 'ResetRetries', type: 'int', readonly: false, rebootRequired: false, default: '1' },
    { key: 'StopTransactionOnEVSideDisconnect', type: 'bool', readonly: false, rebootRequired: false, default: 'true' },
    { key: 'StopTransactionOnInvalidId', type: 'bool', readonly: false, rebootRequired: false, default: 'true' },
    {
        key: 'StopTxnAlignedData',
        type: 'csl',
        readonly: false,
        rebootRequired: false,
        default: 'Energy.Active.Import.Register',
    },
    { key: 'StopTxnAlignedDataMaxLength', type: 'int', readonly: true, rebootRequired: false, default: '4' },
    {
        key: 'StopTxnSampledData',
        type: 'csl',
        readonly: false,
        rebootRequired: false,
        default: 'Energy.Active.Import.Register',
    },
    { key: 'StopTxnSampledDataMaxLength', type: 'int', readonly: true, rebootRequired: false, default: '4' },
    {
        key: 'SupportedFeatureProfiles',
        type: 'csl',
        readonly: true,
        rebootRequired: false,
        default: 'Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger',
    },
    { key: 'SupportedFeatureProfilesMaxLength', type: 'int', readonly: true, rebootRequired: false, default: '6' },
    { key: 'TransactionMessageAttempts', type: 'int', readonly: false, rebootRequired: false, default: '3' },
    { key: 'TransactionMessageRetryInterval', type: 'int', readonly: false, rebootRequired: false, default: '60' },
    { key: 'UnlockConnectorOnEVSideDisconnect', type: 'bool', readonly: false, rebootRequired: false, default: 'true' },
    { key: 'WebSocketPingInterval', type: 'int', readonly: false, rebootRequired: false, default: '0' },

    // LocalAuthListManagement
    { key: 'LocalAuthListEnabled', type: 'bool', readonly: false, rebootRequired: false, default: 'true' },
    { key: 'LocalAuthListMaxLength', type: 'int', readonly: true, rebootRequired: false, default: '1000' },
    { key: 'SendLocalListMaxLength', type: 'int', readonly: true, rebootRequired: false, default: '100' },

    // Reservation
    { key: 'ReserveConnectorZeroSupported', type: 'bool', readonly: true, rebootRequired: false, default: 'true' },

    // SmartCharging
    { key: 'ChargeProfileMaxStackLevel', type: 'int', readonly: true, rebootRequired: false, default: '3' },
    {
        key: 'ChargingScheduleAllowedChargingRateUnit',
        type: 'csl',
        readonly: true,
        rebootRequired: false,
        default: 'Current,Power',
    },
    { key: 'ChargingScheduleMaxPeriods', type: 'int', readonly: true, rebootRequired: false, default: '24' },
    { key: 'MaxChargingProfilesInstalled', type: 'int', readonly: true, rebootRequired: false, default: '8' },
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
            if (value !== 'true' && value !== 'false') return `${spec.key} must be 'true' or 'false'`;
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
