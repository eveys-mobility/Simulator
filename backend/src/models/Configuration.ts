export interface ChargePointConfiguration {
    chargePointId: string;
    ocppServerUrl: string;
    maxPowerKw: number;
    connectorType: 'Type1' | 'Type2' | 'CCS' | 'CHAdeMO';
    voltage: number;
    maxCurrent: number;
    numberOfConnectors: number;
    meterValueInterval: number; // seconds
    heartbeatInterval: number; // seconds
}

export interface ConnectorConfiguration {
    connectorId: number;
    type: string;
    maxPower: number;
    status: ConnectorStatus;
}

export enum ConnectorStatus {
    Available = 'Available',
    Preparing = 'Preparing',
    Charging = 'Charging',
    SuspendedEV = 'SuspendedEV',
    SuspendedEVSE = 'SuspendedEVSE',
    Finishing = 'Finishing',
    Reserved = 'Reserved',
    Unavailable = 'Unavailable',
    Faulted = 'Faulted'
}

export interface OCPPConfiguration {
    key: string;
    readonly: boolean;
    value?: string;
}

/**
 * Comprehensive OCPP 1.6J Configuration Keys
 * Based on OCPP 1.6 specification and real-world charge point implementations
 */
export const defaultOCPPConfiguration: OCPPConfiguration[] = [
    // Core Profile Configuration Keys
    { key: 'AllowOfflineTxForUnknownId', readonly: false, value: 'false' },
    { key: 'AuthorizationCacheEnabled', readonly: false, value: 'false' },
    { key: 'AuthorizeRemoteTxRequests', readonly: false, value: 'false' },
    { key: 'AuthorizationKey', readonly: false, value: '' },
    { key: 'BlinkRepeat', readonly: false, value: '0' },
    { key: 'BootNotificationAfterConnectionLoss', readonly: false, value: 'true' },
    { key: 'ClockAlignedDataInterval', readonly: false, value: '0' },
    { key: 'ConnectionTimeOut', readonly: false, value: '30' },
    { key: 'ConnectorPhaseRotation', readonly: false, value: '0.RST' },
    { key: 'ConnectorPhaseRotationMaxLength', readonly: true, value: '1' },
    { key: 'GetConfigurationMaxKeys', readonly: true, value: '100' },
    { key: 'HeartbeatInterval', readonly: false, value: '60' },
    { key: 'LightIntensity', readonly: false, value: '3' },
    { key: 'LocalAuthListEnabled', readonly: false, value: 'true' },
    { key: 'LocalAuthListMaxLength', readonly: true, value: '100' },
    { key: 'LocalAuthorizeOffline', readonly: false, value: 'true' },
    { key: 'LocalPreAuthorize', readonly: false, value: 'false' },
    { key: 'MaxEnergyOnInvalidId', readonly: false, value: '0' },
    { key: 'MeterValuesAlignedData', readonly: false, value: 'Energy.Active.Import.Register,Power.Active.Import' },
    { key: 'MeterValuesAlignedDataMaxLength', readonly: true, value: '100' },
    { key: 'MeterValuesSampledData', readonly: false, value: 'Energy.Active.Import.Register,Power.Active.Import' },
    { key: 'MeterValueSampleInterval', readonly: false, value: '60' },
    { key: 'MinimumStatusDuration', readonly: false, value: '0' },
    { key: 'NumberOfConnectors', readonly: true, value: '1' },
    { key: 'ResetRetries', readonly: false, value: '3' },
    { key: 'StopTransactionOnEVSideDisconnect', readonly: false, value: 'true' },
    { key: 'StopTransactionOnInvalidId', readonly: false, value: 'true' },
    { key: 'StopTxnAlignedData', readonly: false, value: 'Energy.Active.Import.Register' },
    { key: 'StopTxnSampledData', readonly: false, value: 'Energy.Active.Import.Register' },
    { key: 'TransactionMessageAttempts', readonly: false, value: '3' },
    { key: 'TransactionMessageRetryInterval', readonly: false, value: '20' },
    { key: 'UnlockConnectorOnEVSideDisconnect', readonly: false, value: 'true' },
    { key: 'WebSocketPingInterval', readonly: false, value: '10' },

    // Smart Charging Profile Configuration Keys
    { key: 'ChargeProfileMaxStackLevel', readonly: true, value: '10' },
    { key: 'ChargingScheduleAllowedChargingRateUnit', readonly: true, value: 'Current,Power' },
    { key: 'ChargingScheduleMaxPeriods', readonly: true, value: '10' },
    { key: 'MaxChargingProfilesInstalled', readonly: true, value: '10' },

    // Security Profile Configuration Keys
    { key: 'SecurityProfile', readonly: false, value: '0' },

    // Local Auth List Management Profile
    { key: 'SendLocalListMaxLength', readonly: true, value: '100' },
    { key: 'LocalAuthListMaxLength', readonly: true, value: '100' },

    // Reservation Profile
    { key: 'ReserveConnectorZeroSupported', readonly: true, value: 'false' },

    // Custom / Vendor-Specific Configuration Keys
    { key: 'FreeModeActive', readonly: false, value: 'false' },
    { key: 'FreeModeRFID', readonly: false, value: '0' },
    { key: 'ContinueChargingAfterPowerLoss', readonly: false, value: 'false' },
    { key: 'SendTotalPowerValue', readonly: false, value: 'true' },
    { key: 'LockableCable', readonly: false, value: 'false' },
    { key: 'UnbalancedLoadDetection', readonly: false, value: 'false' },
    { key: 'DisplayBacklightLevel', readonly: false, value: 'mid' },
    { key: 'DisplayBacklightSunrise', readonly: false, value: '07:00' },
    { key: 'DisplayBacklightSunset', readonly: false, value: '19:00' },
    { key: 'LedDimmingLevel', readonly: false, value: 'mid' },
    { key: 'LedDimmingSunrise', readonly: false, value: '07:00' },
    { key: 'LedDimmingSunset', readonly: false, value: '19:00' },
    { key: 'StandbyLed', readonly: false, value: 'true' },
    { key: 'RfidEndianness', readonly: false, value: 'big-endian' },
    { key: 'Location', readonly: false, value: 'indoor' },
    { key: 'PowerOptimizer', readonly: false, value: '0' },
    { key: 'LoadSheddingMinimumCurrent', readonly: false, value: '8' },
    { key: 'UnbalancedLoadDetectionMaxCurrent', readonly: false, value: '20' },
    { key: 'CurrentLimiterValue', readonly: false, value: '32' },
    { key: 'CurrentLimiterPhase', readonly: false, value: 'threePhase' },
    { key: 'DailyReboot', readonly: false, value: 'true' },
    { key: 'DailyRebootTime', readonly: false, value: '03:00' },
    { key: 'DailyRebootType', readonly: false, value: 'SOFT' },
    { key: 'RandomisedDelayMaxSeconds', readonly: false, value: '0' },
    { key: 'RandomDelayOnDailyRebootEnabled', readonly: false, value: 'true' },
    { key: 'OffPeakCharging', readonly: false, value: 'false' },
    { key: 'OffPeakChargingWeekend', readonly: false, value: 'false' },
    { key: 'OffPeakChargingTimeSlots', readonly: false, value: '-,-' },
    { key: 'ContinueAfterOffPeakHour', readonly: false, value: 'false' },
    { key: 'ForcedCharging', readonly: false, value: '' },
    { key: 'timeZone', readonly: false, value: 'UTC' },
    { key: 'apnInfo', readonly: false, value: 'internet,,' },
    { key: 'UKSmartChargingEnabled', readonly: false, value: 'false' },
    { key: 'randomisedDelayAtOffPeakEnd', readonly: false, value: 'false' },
    { key: 'RandomizedDelayMax', readonly: false, value: '0' },
    { key: 'SendDataTransferMeterConfigurationForNonEichrecht', readonly: false, value: 'false' },
    { key: 'AdhocUrlPrefix', readonly: false, value: '' },
    { key: 'CentralSmartChargingWithNoTripping', readonly: false, value: 'false' },
    { key: 'LEDTimeoutEnable', readonly: false, value: 'false' },
    { key: 'OperationMode', readonly: false, value: '1' },
    { key: 'NewTransactionAfterPowerLoss', readonly: false, value: 'false' },
    { key: 'CTStationCurrentInformationInterval', readonly: false, value: '0' },
    { key: 'MaxPowerChargeComplete', readonly: false, value: '0' },
    { key: 'MaxTimeChargeComplete', readonly: false, value: '0' },
    { key: 'DisplayLanguage', readonly: false, value: 'en' },
];
