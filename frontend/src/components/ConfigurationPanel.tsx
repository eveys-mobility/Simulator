import React, { useState, useEffect } from 'react';
import { Search, Settings, Info, Check, X, RotateCcw } from 'lucide-react';

interface ConfigItem {
    key: string;
    value?: string;
    readonly: boolean;
}

interface ConfigMetadata {
    category: string;
    description: string;
    type: 'number' | 'boolean' | 'string' | 'list';
    unit?: string;
    min?: number;
    max?: number;
    options?: string[];
}

const configMetadata: Record<string, ConfigMetadata> = {
    // Core Profile - Timing & Intervals
    'HeartbeatInterval': {
        category: 'Timing & Intervals',
        description: 'Interval in seconds between heartbeat messages sent to the central system. Lower values increase network traffic but provide faster connection monitoring.',
        type: 'number',
        unit: 'seconds',
        min: 10,
        max: 3600
    },
    'MeterValueSampleInterval': {
        category: 'Timing & Intervals',
        description: 'Interval in seconds between meter value reports during charging. Controls how frequently energy consumption data is sent to the central system.',
        type: 'number',
        unit: 'seconds',
        min: 5,
        max: 3600
    },
    'ClockAlignedDataInterval': {
        category: 'Timing & Intervals',
        description: 'Interval in seconds for clock-aligned meter value reports. Set to 0 to disable. When enabled, meter values are sent at exact clock intervals (e.g., every hour on the hour).',
        type: 'number',
        unit: 'seconds',
        min: 0,
        max: 3600
    },
    'ConnectionTimeOut': {
        category: 'Timing & Intervals',
        description: 'Maximum time in seconds to wait for a WebSocket connection to establish before timing out.',
        type: 'number',
        unit: 'seconds',
        min: 10,
        max: 300
    },
    'WebSocketPingInterval': {
        category: 'Timing & Intervals',
        description: 'Interval in seconds between WebSocket ping messages to keep the connection alive.',
        type: 'number',
        unit: 'seconds',
        min: 5,
        max: 300
    },
    'MinimumStatusDuration': {
        category: 'Timing & Intervals',
        description: 'Minimum duration in seconds that a status must be maintained before changing to another status.',
        type: 'number',
        unit: 'seconds',
        min: 0,
        max: 60
    },

    // Transaction Behavior
    'AllowOfflineTxForUnknownId': {
        category: 'Transaction Behavior',
        description: 'Allow transactions to start for unknown RFID tags when the charge point is offline. Useful for ensuring service availability during network outages.',
        type: 'boolean'
    },
    'AuthorizeRemoteTxRequests': {
        category: 'Transaction Behavior',
        description: 'Require authorization before starting a transaction initiated by RemoteStartTransaction. When false, remote transactions start without authorization.',
        type: 'boolean'
    },
    'LocalAuthorizeOffline': {
        category: 'Transaction Behavior',
        description: 'Use local authorization list when offline. Allows charging to continue even when the central system is unreachable.',
        type: 'boolean'
    },
    'LocalPreAuthorize': {
        category: 'Transaction Behavior',
        description: 'Pre-authorize RFID tags using the local authorization list before sending Authorize request to central system.',
        type: 'boolean'
    },
    'StopTransactionOnEVSideDisconnect': {
        category: 'Transaction Behavior',
        description: 'Automatically stop the transaction when the EV cable is disconnected. Prevents unauthorized energy consumption.',
        type: 'boolean'
    },
    'StopTransactionOnInvalidId': {
        category: 'Transaction Behavior',
        description: 'Automatically stop the transaction if the RFID tag becomes invalid during charging.',
        type: 'boolean'
    },
    'UnlockConnectorOnEVSideDisconnect': {
        category: 'Transaction Behavior',
        description: 'Unlock the connector when the EV cable is disconnected from the vehicle side.',
        type: 'boolean'
    },
    'TransactionMessageAttempts': {
        category: 'Transaction Behavior',
        description: 'Number of retry attempts for StartTransaction and StopTransaction messages if they fail. Higher values improve reliability but may delay error detection.',
        type: 'number',
        min: 1,
        max: 10
    },
    'TransactionMessageRetryInterval': {
        category: 'Transaction Behavior',
        description: 'Delay in seconds between retry attempts for transaction messages.',
        type: 'number',
        unit: 'seconds',
        min: 5,
        max: 300
    },
    'MaxEnergyOnInvalidId': {
        category: 'Transaction Behavior',
        description: 'Maximum energy in Wh that can be consumed with an invalid RFID tag. Set to 0 to prevent any charging.',
        type: 'number',
        unit: 'Wh',
        min: 0,
        max: 100000
    },

    // Meter Values Configuration
    'MeterValuesSampledData': {
        category: 'Meter Values',
        description: 'Comma-separated list of measurands to include in periodic meter value reports. Options: Energy.Active.Import.Register, Power.Active.Import, Current.Import, Voltage, Temperature, SoC, Frequency',
        type: 'list'
    },
    'MeterValuesAlignedData': {
        category: 'Meter Values',
        description: 'Comma-separated list of measurands to include in clock-aligned meter value reports.',
        type: 'list'
    },
    'StopTxnSampledData': {
        category: 'Meter Values',
        description: 'Comma-separated list of measurands to include in StopTransaction message.',
        type: 'list'
    },
    'StopTxnAlignedData': {
        category: 'Meter Values',
        description: 'Comma-separated list of measurands to include as clock-aligned data in StopTransaction message.',
        type: 'list'
    },

    // Authorization
    'AuthorizationCacheEnabled': {
        category: 'Authorization',
        description: 'Enable caching of authorization results to reduce network traffic and improve response time.',
        type: 'boolean'
    },
    'LocalAuthListEnabled': {
        category: 'Authorization',
        description: 'Enable use of local authorization list for offline authorization.',
        type: 'boolean'
    },
    'LocalAuthListMaxLength': {
        category: 'Authorization',
        description: 'Maximum number of entries in the local authorization list.',
        type: 'number',
        min: 0,
        max: 10000
    },

    // Power Management
    'CurrentLimiterValue': {
        category: 'Power Management',
        description: 'Maximum charging current in Amperes. Limits the maximum power output. For 3-phase 400V: 32A ≈ 22kW, 16A ≈ 11kW, 8A ≈ 5.5kW',
        type: 'number',
        unit: 'A',
        min: 6,
        max: 80
    },
    'CurrentLimiterPhase': {
        category: 'Power Management',
        description: 'Phase configuration for current limiting.',
        type: 'string',
        options: ['singlePhase', 'threePhase']
    },
    'LoadSheddingMinimumCurrent': {
        category: 'Power Management',
        description: 'Minimum current in Amperes during load shedding. Ensures minimum charging rate is maintained.',
        type: 'number',
        unit: 'A',
        min: 6,
        max: 32
    },
    'PowerOptimizer': {
        category: 'Power Management',
        description: 'Power optimization mode. 0 = disabled, 1 = eco mode, 2 = balanced, 3 = performance',
        type: 'number',
        min: 0,
        max: 3
    },
    'UnbalancedLoadDetection': {
        category: 'Power Management',
        description: 'Enable detection and handling of unbalanced loads across phases.',
        type: 'boolean'
    },
    'UnbalancedLoadDetectionMaxCurrent': {
        category: 'Power Management',
        description: 'Maximum current difference in Amperes between phases before triggering unbalanced load protection.',
        type: 'number',
        unit: 'A',
        min: 1,
        max: 20
    },
    'MaxPowerChargeComplete': {
        category: 'Power Management',
        description: 'Power threshold in Watts below which charging is considered complete. Set to 0 to disable.',
        type: 'number',
        unit: 'W',
        min: 0,
        max: 1000
    },
    'MaxTimeChargeComplete': {
        category: 'Power Management',
        description: 'Time threshold in seconds of low power before charging is considered complete. Set to 0 to disable.',
        type: 'number',
        unit: 'seconds',
        min: 0,
        max: 3600
    },

    // Scheduling & Automation
    'DailyReboot': {
        category: 'Scheduling',
        description: 'Enable automatic daily reboot of the charge point for maintenance and stability.',
        type: 'boolean'
    },
    'DailyRebootTime': {
        category: 'Scheduling',
        description: 'Time of day for daily reboot in HH:MM format (24-hour). Example: 03:00 for 3 AM',
        type: 'string'
    },
    'DailyRebootType': {
        category: 'Scheduling',
        description: 'Type of daily reboot to perform.',
        type: 'string',
        options: ['SOFT', 'HARD']
    },
    'RandomDelayOnDailyRebootEnabled': {
        category: 'Scheduling',
        description: 'Add random delay to daily reboot time to prevent all charge points from rebooting simultaneously.',
        type: 'boolean'
    },
    'RandomisedDelayMaxSeconds': {
        category: 'Scheduling',
        description: 'Maximum random delay in seconds to add to scheduled times (reboot, off-peak, etc.).',
        type: 'number',
        unit: 'seconds',
        min: 0,
        max: 3600
    },
    'OffPeakCharging': {
        category: 'Scheduling',
        description: 'Enable off-peak charging mode to reduce energy costs during low-demand periods.',
        type: 'boolean'
    },
    'OffPeakChargingWeekend': {
        category: 'Scheduling',
        description: 'Enable off-peak charging on weekends.',
        type: 'boolean'
    },
    'OffPeakChargingTimeSlots': {
        category: 'Scheduling',
        description: 'Time slots for off-peak charging in format HH:MM-HH:MM,HH:MM-HH:MM. Example: 22:00-06:00,12:00-14:00',
        type: 'string'
    },
    'ContinueAfterOffPeakHour': {
        category: 'Scheduling',
        description: 'Continue charging after off-peak hours end if a session is active.',
        type: 'boolean'
    },

    // Display & UI
    'DisplayLanguage': {
        category: 'Display & UI',
        description: 'Language code for display interface.',
        type: 'string',
        options: ['en', 'tr', 'de', 'fr', 'es', 'it']
    },
    'DisplayBacklightLevel': {
        category: 'Display & UI',
        description: 'Display backlight brightness level.',
        type: 'string',
        options: ['low', 'mid', 'high']
    },
    'DisplayBacklightSunrise': {
        category: 'Display & UI',
        description: 'Time to increase display brightness in HH:MM format. Example: 07:00',
        type: 'string'
    },
    'DisplayBacklightSunset': {
        category: 'Display & UI',
        description: 'Time to decrease display brightness in HH:MM format. Example: 19:00',
        type: 'string'
    },
    'LedDimmingLevel': {
        category: 'Display & UI',
        description: 'LED indicator brightness level.',
        type: 'string',
        options: ['low', 'mid', 'high']
    },
    'LedDimmingSunrise': {
        category: 'Display & UI',
        description: 'Time to increase LED brightness in HH:MM format.',
        type: 'string'
    },
    'LedDimmingSunset': {
        category: 'Display & UI',
        description: 'Time to decrease LED brightness in HH:MM format.',
        type: 'string'
    },
    'StandbyLed': {
        category: 'Display & UI',
        description: 'Enable LED indicator in standby mode.',
        type: 'boolean'
    },
    'LEDTimeoutEnable': {
        category: 'Display & UI',
        description: 'Enable automatic LED timeout to save energy.',
        type: 'boolean'
    },
    'LightIntensity': {
        category: 'Display & UI',
        description: 'Overall light intensity level (0-5).',
        type: 'number',
        min: 0,
        max: 5
    },

    // Network & Connectivity
    'BootNotificationAfterConnectionLoss': {
        category: 'Network',
        description: 'Send BootNotification message after reconnecting to the central system.',
        type: 'boolean'
    },
    'ContinueChargingAfterPowerLoss': {
        category: 'Network',
        description: 'Resume charging session after power is restored.',
        type: 'boolean'
    },
    'NewTransactionAfterPowerLoss': {
        category: 'Network',
        description: 'Start a new transaction after power loss instead of resuming the previous one.',
        type: 'boolean'
    },

    // System Configuration (Readonly)
    'NumberOfConnectors': {
        category: 'System',
        description: 'Number of charging connectors available on this charge point. This value is readonly and determined by hardware.',
        type: 'number'
    },
    'GetConfigurationMaxKeys': {
        category: 'System',
        description: 'Maximum number of configuration keys that can be requested in a single GetConfiguration message.',
        type: 'number'
    },
    'ConnectorPhaseRotation': {
        category: 'System',
        description: 'Phase rotation configuration for connectors. Format: connectorId.phaseRotation',
        type: 'string'
    },
    'ConnectorPhaseRotationMaxLength': {
        category: 'System',
        description: 'Maximum number of connector phase rotation entries.',
        type: 'number'
    },

    // Smart Charging
    'ChargeProfileMaxStackLevel': {
        category: 'Smart Charging',
        description: 'Maximum stack level for charge profiles. Higher levels override lower levels.',
        type: 'number'
    },
    'ChargingScheduleAllowedChargingRateUnit': {
        category: 'Smart Charging',
        description: 'Allowed units for charging rate in charging schedules.',
        type: 'string'
    },
    'ChargingScheduleMaxPeriods': {
        category: 'Smart Charging',
        description: 'Maximum number of periods in a charging schedule.',
        type: 'number'
    },
    'MaxChargingProfilesInstalled': {
        category: 'Smart Charging',
        description: 'Maximum number of charging profiles that can be installed.',
        type: 'number'
    },

    // Security
    'SecurityProfile': {
        category: 'Security',
        description: 'Security profile level. 0 = unsecured, 1 = TLS with basic authentication, 2 = TLS with client certificates, 3 = TLS with client certificates and central system certificates',
        type: 'number',
        min: 0,
        max: 3
    },

    // Vendor-Specific
    'FreeModeActive': {
        category: 'Vendor-Specific',
        description: 'Enable free charging mode (no authentication required).',
        type: 'boolean'
    },
    'FreeModeRFID': {
        category: 'Vendor-Specific',
        description: 'RFID tag to use for free mode charging.',
        type: 'string'
    },
    'LockableCable': {
        category: 'Vendor-Specific',
        description: 'Charge point has a lockable cable.',
        type: 'boolean'
    },
    'Location': {
        category: 'Vendor-Specific',
        description: 'Physical location type of the charge point.',
        type: 'string',
        options: ['indoor', 'outdoor', 'covered']
    },
    'RfidEndianness': {
        category: 'Vendor-Specific',
        description: 'Byte order for RFID tag reading.',
        type: 'string',
        options: ['big-endian', 'little-endian']
    },
    'OperationMode': {
        category: 'Vendor-Specific',
        description: 'Operation mode of the charge point. 1 = normal, 2 = maintenance, 3 = diagnostic',
        type: 'number',
        min: 1,
        max: 3
    },
    'SendTotalPowerValue': {
        category: 'Vendor-Specific',
        description: 'Include total power value in meter values.',
        type: 'boolean'
    },
    'timeZone': {
        category: 'Vendor-Specific',
        description: 'Time zone for the charge point. Example: UTC, Europe/London, America/New_York',
        type: 'string'
    },
    'apnInfo': {
        category: 'Vendor-Specific',
        description: 'APN information for mobile connectivity in format: apn,username,password',
        type: 'string'
    },
    'UKSmartChargingEnabled': {
        category: 'Vendor-Specific',
        description: 'Enable UK-specific smart charging features.',
        type: 'boolean'
    },
    'CentralSmartChargingWithNoTripping': {
        category: 'Vendor-Specific',
        description: 'Enable central smart charging without circuit breaker tripping.',
        type: 'boolean'
    },
    'CTStationCurrentInformationInterval': {
        category: 'Vendor-Specific',
        description: 'Interval in seconds for sending current information to CT station. Set to 0 to disable.',
        type: 'number',
        unit: 'seconds',
        min: 0,
        max: 3600
    },
    'SendDataTransferMeterConfigurationForNonEichrecht': {
        category: 'Vendor-Specific',
        description: 'Send meter configuration via DataTransfer for non-Eichrecht compliant meters.',
        type: 'boolean'
    },
    'AdhocUrlPrefix': {
        category: 'Vendor-Specific',
        description: 'URL prefix for ad-hoc charging sessions.',
        type: 'string'
    },
    'BlinkRepeat': {
        category: 'Vendor-Specific',
        description: 'Number of times to blink LED indicators. Set to 0 for continuous.',
        type: 'number',
        min: 0,
        max: 10
    },
    'ResetRetries': {
        category: 'System',
        description: 'Number of retry attempts for reset operations.',
        type: 'number',
        min: 1,
        max: 10
    }
};

export default function ConfigurationPanel() {
    const [configurations, setConfigurations] = useState<ConfigItem[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        fetchConfigurations();
    }, []);

    const fetchConfigurations = async () => {
        try {
            const response = await fetch('http://localhost:3001/api/config');
            const data = await response.json();
            setConfigurations(data.configuration || []);
        } catch (error) {
            console.error('Error fetching configurations:', error);
            showMessage('error', 'Failed to load configurations');
        }
    };

    const showMessage = (type: 'success' | 'error', text: string) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 3000);
    };

    const handleSave = async (key: string, value: string) => {
        setLoading(true);
        try {
            const response = await fetch('http://localhost:3001/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value })
            });

            if (response.ok) {
                await fetchConfigurations();
                setEditingKey(null);
                showMessage('success', `Configuration "${key}" updated successfully`);
            } else {
                const error = await response.json();
                showMessage('error', error.message || 'Failed to update configuration');
            }
        } catch (error) {
            showMessage('error', 'Network error while updating configuration');
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (key: string, currentValue: string) => {
        setEditingKey(key);
        setEditValue(currentValue || '');
    };

    const handleCancel = () => {
        setEditingKey(null);
        setEditValue('');
    };

    const categories = ['All', ...Array.from(new Set(Object.values(configMetadata).map(m => m.category)))];

    const filteredConfigurations = configurations.filter(config => {
        const matchesSearch = config.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
            configMetadata[config.key]?.description?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === 'All' || configMetadata[config.key]?.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const groupedConfigurations = filteredConfigurations.reduce((acc, config) => {
        const category = configMetadata[config.key]?.category || 'Other';
        if (!acc[category]) acc[category] = [];
        acc[category].push(config);
        return acc;
    }, {} as Record<string, ConfigItem[]>);

    return (
        <div className="config-panel">
            <div className="config-header">
                <div className="config-title">
                    <Settings className="icon" />
                    <h2>OCPP Configuration Management</h2>
                </div>
                <p className="config-subtitle">
                    {configurations.length} configuration keys • {filteredConfigurations.length} shown
                </p>
            </div>

            {message && (
                <div className={`message message-${message.type}`}>
                    {message.type === 'success' ? <Check size={16} /> : <X size={16} />}
                    <span>{message.text}</span>
                </div>
            )}

            <div className="config-filters">
                <div className="search-box">
                    <Search className="search-icon" size={18} />
                    <input
                        type="text"
                        placeholder="Search configurations..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                    />
                </div>

                <div className="category-filter">
                    {categories.map(category => (
                        <button
                            key={category}
                            className={`category-btn ${selectedCategory === category ? 'active' : ''}`}
                            onClick={() => setSelectedCategory(category)}
                        >
                            {category}
                        </button>
                    ))}
                </div>
            </div>

            <div className="config-list">
                {Object.entries(groupedConfigurations).map(([category, configs]) => (
                    <div key={category} className="config-category">
                        <h3 className="category-title">{category}</h3>
                        <div className="config-items">
                            {configs.map(config => {
                                const metadata = configMetadata[config.key];
                                const isEditing = editingKey === config.key;

                                return (
                                    <div key={config.key} className="config-item">
                                        <div className="config-item-header">
                                            <div className="config-key-info">
                                                <span className="config-key">{config.key}</span>
                                                {config.readonly && (
                                                    <span className="readonly-badge">Read-only</span>
                                                )}
                                                {metadata && (
                                                    <span className="config-type">{metadata.type}</span>
                                                )}
                                            </div>
                                        </div>

                                        {metadata && (
                                            <div className="config-description">
                                                <Info size={14} className="info-icon" />
                                                <p>{metadata.description}</p>
                                            </div>
                                        )}

                                        <div className="config-value-section">
                                            {isEditing ? (
                                                <div className="config-edit">
                                                    {metadata?.options ? (
                                                        <select
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            className="config-select"
                                                        >
                                                            {metadata.options.map(option => (
                                                                <option key={option} value={option}>{option}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <input
                                                            type={metadata?.type === 'number' ? 'number' : 'text'}
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            className="config-input"
                                                            min={metadata?.min}
                                                            max={metadata?.max}
                                                            placeholder={`Enter ${metadata?.type || 'value'}...`}
                                                        />
                                                    )}
                                                    {metadata?.unit && (
                                                        <span className="config-unit">{metadata.unit}</span>
                                                    )}
                                                    <div className="config-actions">
                                                        <button
                                                            onClick={() => handleSave(config.key, editValue)}
                                                            disabled={loading}
                                                            className="btn-save"
                                                        >
                                                            <Check size={16} />
                                                            Save
                                                        </button>
                                                        <button
                                                            onClick={handleCancel}
                                                            disabled={loading}
                                                            className="btn-cancel"
                                                        >
                                                            <X size={16} />
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="config-display">
                                                    <div className="config-current-value">
                                                        <span className="value-label">Current Value:</span>
                                                        <span className="value-text">
                                                            {config.value || '(not set)'}
                                                            {metadata?.unit && config.value && ` ${metadata.unit}`}
                                                        </span>
                                                    </div>
                                                    {!config.readonly && (
                                                        <button
                                                            onClick={() => handleEdit(config.key, config.value || '')}
                                                            className="btn-edit"
                                                        >
                                                            Edit
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {metadata?.min !== undefined && metadata?.max !== undefined && (
                                            <div className="config-range">
                                                <span>Range: {metadata.min} - {metadata.max} {metadata.unit || ''}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {filteredConfigurations.length === 0 && (
                <div className="no-results">
                    <Search size={48} />
                    <p>No configurations found matching "{searchTerm}"</p>
                </div>
            )}
        </div>
    );
}
