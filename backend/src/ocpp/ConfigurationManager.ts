import { EventEmitter } from 'events';
import { OCPPConfiguration, defaultOCPPConfiguration } from '../models/Configuration';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Configuration Manager
 * Handles OCPP configuration storage, retrieval, and persistence
 */
export class ConfigurationManager extends EventEmitter {
    private configuration: Map<string, OCPPConfiguration> = new Map();
    private configFilePath: string;

    constructor(chargePointId: string, numberOfConnectors?: number) {
        super();
        this.configFilePath = path.join(process.cwd(), 'data', `config_${chargePointId}.json`);
        this.loadConfiguration();
        // The runtime connector count (from server.ts config / env) is the
        // source of truth — always overwrite whatever was in the saved
        // file or the defaults so the OCPP `NumberOfConnectors` advertised
        // back to the CSMS matches the simulator's actual setup.
        if (typeof numberOfConnectors === 'number' && Number.isFinite(numberOfConnectors)) {
            const existing = this.configuration.get('NumberOfConnectors');
            if (!existing || existing.value !== String(numberOfConnectors)) {
                this.configuration.set('NumberOfConnectors', {
                    key: 'NumberOfConnectors',
                    readonly: true,
                    value: String(numberOfConnectors),
                });
                this.saveConfiguration();
            }
        }
    }

    /**
     * Load configuration from file or use defaults
     */
    private loadConfiguration(): void {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.configFilePath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Load from file if exists
            if (fs.existsSync(this.configFilePath)) {
                const data = fs.readFileSync(this.configFilePath, 'utf-8');
                const savedConfig: OCPPConfiguration[] = JSON.parse(data);

                // Merge saved config with defaults (in case new keys were added)
                const configMap = new Map<string, OCPPConfiguration>();

                // Start with defaults
                defaultOCPPConfiguration.forEach(config => {
                    configMap.set(config.key, { ...config });
                });

                // Override with saved values
                savedConfig.forEach(config => {
                    if (configMap.has(config.key)) {
                        const existing = configMap.get(config.key)!;
                        configMap.set(config.key, {
                            ...existing,
                            value: config.value
                        });
                    } else {
                        // Add custom keys that aren't in defaults
                        configMap.set(config.key, config);
                    }
                });

                this.configuration = configMap;
                console.log(`[ConfigurationManager] Loaded configuration from ${this.configFilePath}`);
            } else {
                // Use defaults
                defaultOCPPConfiguration.forEach(config => {
                    this.configuration.set(config.key, { ...config });
                });
                this.saveConfiguration();
                console.log('[ConfigurationManager] Initialized with default configuration');
            }
        } catch (error) {
            console.error('[ConfigurationManager] Error loading configuration:', error);
            // Fallback to defaults
            defaultOCPPConfiguration.forEach(config => {
                this.configuration.set(config.key, { ...config });
            });
        }
    }

    /**
     * Save configuration to file
     */
    private saveConfiguration(): void {
        try {
            const configArray = Array.from(this.configuration.values());
            fs.writeFileSync(this.configFilePath, JSON.stringify(configArray, null, 2));
            console.log('[ConfigurationManager] Configuration saved');
        } catch (error) {
            console.error('[ConfigurationManager] Error saving configuration:', error);
        }
    }

    /**
     * Get configuration value by key
     */
    public getValue(key: string): string | undefined {
        return this.configuration.get(key)?.value;
    }

    /**
     * Get configuration value as number
     */
    public getValueAsNumber(key: string, defaultValue: number = 0): number {
        const value = this.getValue(key);
        if (!value) return defaultValue;
        const num = parseInt(value);
        return isNaN(num) ? defaultValue : num;
    }

    /**
     * Get configuration value as boolean
     */
    public getValueAsBoolean(key: string, defaultValue: boolean = false): boolean {
        const value = this.getValue(key);
        if (!value) return defaultValue;
        return value.toLowerCase() === 'true';
    }

    /**
     * Get all configuration keys (for GetConfiguration request)
     */
    public getConfiguration(keys?: string[]): { configurationKey: OCPPConfiguration[], unknownKey: string[] } {
        if (!keys || keys.length === 0) {
            // Return all configuration
            return {
                configurationKey: Array.from(this.configuration.values()),
                unknownKey: []
            };
        }

        const configurationKey: OCPPConfiguration[] = [];
        const unknownKey: string[] = [];

        keys.forEach(key => {
            const config = this.configuration.get(key);
            if (config) {
                configurationKey.push(config);
            } else {
                unknownKey.push(key);
            }
        });

        return { configurationKey, unknownKey };
    }

    /**
     * Change configuration value (for ChangeConfiguration request)
     */
    public changeConfiguration(key: string, value: string): 'Accepted' | 'Rejected' | 'RebootRequired' | 'NotSupported' {
        const config = this.configuration.get(key);

        if (!config) {
            return 'NotSupported';
        }

        if (config.readonly) {
            return 'Rejected';
        }

        // Check if change requires reboot
        const rebootRequiredKeys = [
            'HeartbeatInterval',
            'MeterValueSampleInterval',
            'WebSocketPingInterval',
            'ConnectionTimeOut',
            'NumberOfConnectors',
            'SecurityProfile'
        ];

        const oldValue = config.value;
        config.value = value;
        this.configuration.set(key, config);
        this.saveConfiguration();

        // Emit event for value change
        this.emit('configurationChanged', { key, oldValue, newValue: value });

        if (rebootRequiredKeys.includes(key)) {
            return 'RebootRequired';
        }

        return 'Accepted';
    }

    /**
     * Add custom configuration key
     */
    public addCustomKey(key: string, value: string, readonly: boolean = false): void {
        if (!this.configuration.has(key)) {
            this.configuration.set(key, { key, value, readonly });
            this.saveConfiguration();
        }
    }

    /**
     * Get all configuration as array
     */
    public getAllConfiguration(): OCPPConfiguration[] {
        return Array.from(this.configuration.values());
    }

    /**
     * Reset to default configuration
     */
    public resetToDefaults(): void {
        this.configuration.clear();
        defaultOCPPConfiguration.forEach(config => {
            this.configuration.set(config.key, { ...config });
        });
        this.saveConfiguration();
        this.emit('configurationReset');
    }
}
