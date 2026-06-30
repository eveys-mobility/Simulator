import {
    CONFIG_KEY_INDEX,
    type ChangeConfigStatus,
    type ConfigKeySpec,
    STANDARD_CONFIG_KEYS,
    validateConfigValue,
} from '@ocpp-sim/core';
import type { Store } from './store.js';

/**
 * Per-device OCPP configuration. Wraps the SQLite store, applies a
 * subscriber callback on each change so live consumers (heartbeat
 * cadence, meter-value cadence, …) react without polling.
 *
 * NumberOfConnectors is overridden from the device row at construction
 * — it's a derived fact about the device, not a CSMS-writable value.
 */
export class OcppConfig {
    private listeners: ((key: string, value: string) => void)[] = [];

    constructor(
        private readonly store: Store,
        private readonly deviceId: string,
        private readonly numberOfConnectors: number,
    ) {
        // Lazy-seed defaults the first time we encounter this device.
        const present = new Set(this.store.listConfig(deviceId).map((r) => r.key));
        for (const spec of STANDARD_CONFIG_KEYS) {
            if (present.has(spec.key)) continue;
            const value =
                spec.key === 'NumberOfConnectors' ? String(numberOfConnectors) : spec.default;
            this.store.setConfig(deviceId, spec.key, value);
        }
        // NumberOfConnectors is read-only and reflects the device — keep
        // it in sync if the row ever changes (e.g. type change, future).
        if (this.store.getConfig(deviceId, 'NumberOfConnectors') !== String(numberOfConnectors)) {
            this.store.setConfig(deviceId, 'NumberOfConnectors', String(numberOfConnectors));
        }
    }

    onChange(fn: (key: string, value: string) => void): () => void {
        this.listeners.push(fn);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== fn);
        };
    }

    /** Get the current value (always a string per OCPP). */
    get(key: string): string | null {
        return this.store.getConfig(this.deviceId, key);
    }

    getNumber(key: string): number | null {
        const v = this.get(key);
        if (v === null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    getBool(key: string): boolean | null {
        const v = this.get(key);
        if (v === 'true') return true;
        if (v === 'false') return false;
        return null;
    }

    /** OCPP `GetConfiguration` semantics: missing keys go in `unknownKey`. */
    getMany(keys: string[] | undefined): {
        configurationKey: { key: string; readonly: boolean; value?: string }[];
        unknownKey: string[];
    } {
        const all = this.store.listConfig(this.deviceId);
        const valuesByKey = new Map(all.map((r) => [r.key, r.value]));
        if (!keys || keys.length === 0) {
            return {
                configurationKey: all.map((r) => {
                    const spec = CONFIG_KEY_INDEX.get(r.key);
                    return {
                        key: r.key,
                        readonly: spec?.readonly ?? false,
                        value: r.value,
                    };
                }),
                unknownKey: [],
            };
        }
        const out: { key: string; readonly: boolean; value?: string }[] = [];
        const unknown: string[] = [];
        for (const k of keys) {
            const v = valuesByKey.get(k);
            if (v === undefined) {
                unknown.push(k);
                continue;
            }
            const spec = CONFIG_KEY_INDEX.get(k);
            out.push({ key: k, readonly: spec?.readonly ?? false, value: v });
        }
        return { configurationKey: out, unknownKey: unknown };
    }

    /** OCPP `ChangeConfiguration` semantics. Returns the wire-status. */
    set(key: string, value: string): ChangeConfigStatus {
        const spec: ConfigKeySpec | undefined = CONFIG_KEY_INDEX.get(key);
        if (!spec) return 'NotSupported';
        if (spec.readonly) return 'Rejected';
        const err = validateConfigValue(spec, value);
        if (err) return 'Rejected';
        this.store.setConfig(this.deviceId, key, value);
        for (const fn of this.listeners) {
            try {
                fn(key, value);
            } catch {
                // listener errors must not surface to the CSMS
            }
        }
        return spec.rebootRequired ? 'RebootRequired' : 'Accepted';
    }
}
