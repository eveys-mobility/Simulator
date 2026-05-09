/**
 * Worker ↔ supervisor message protocol.
 *
 * Tagged-union types so a single switch on `type` exhausts both
 * directions. Anything that needs to cross the worker_threads boundary
 * goes here; never serialize raw OCPP objects across the channel
 * (they'll lose their prototypes).
 *
 * v1 keeps it deliberately small: spawn → init → ready → action loop
 * → shutdown. SQLite snapshots, LB sessions API, and pubsub coalescing
 * land in MR-E/F.
 */

export type CPType = 'AC' | 'DC';

export type PhaseMode = 'balanced' | 'imbalanced' | 'single-phase';

export interface DCBatteryProfile {
    capacity_kwh?: number;
    charger_max_kw?: number;
    nominal_voltage_v?: number;
    initial_soc_pct?: number;
    target_soc_pct?: number;
    ramp_up_seconds?: number;
}

/** Parent → worker. */
export type DownMessage =
    | { type: 'init';
        cp_id: string;
        cp_type: CPType;
        ocpp_url: string;
        phase_mode?: PhaseMode;
        dc_profile?: DCBatteryProfile;
        max_power_kw?: number;
        heartbeat_interval_s?: number;
        meter_value_interval_s?: number;
      }
    | { type: 'plug_in';        connector_id: number; id_tag: string }
    | { type: 'start_charging'; connector_id: number }
    | { type: 'stop_charging';  connector_id: number; reason?: string }
    | { type: 'pause_charging'; connector_id: number }
    | { type: 'resume_charging';connector_id: number }
    | { type: 'plug_out';       connector_id: number }
    | { type: 'emergency_stop'; connector_id: number }
    | { type: 'set_phase_mode'; mode: PhaseMode }
    | { type: 'set_dc_profile'; profile: DCBatteryProfile }
    | { type: 'fault'; connector_id: number; clear_after_seconds?: number }
    | { type: 'ping'; nonce: number }
    | { type: 'shutdown' };

/** Worker → parent. */
export type UpMessage =
    | { type: 'ready' }
    | { type: 'connected' }
    | { type: 'disconnected' }
    | { type: 'session_started';
        connector_id: number;
        transaction_id: number;
        id_tag: string;
      }
    | { type: 'session_ended';
        connector_id: number;
        transaction_id: number;
        energy_wh: number;
        peak_power_kw: number;
        reason: string;
      }
    | { type: 'meter_tick';
        connector_id: number;
        power_kw: number;
        energy_kwh: number;
        soc_pct?: number;
      }
    | { type: 'connector_status';
        connector_id: number;
        status: string;
      }
    | { type: 'error';
        level: 'warn' | 'error';
        message: string;
      }
    | { type: 'pong'; nonce: number };

/**
 * Narrow runtime guards for the parent — workers can run untrusted
 * input only via the message channel, but a bad UpMessage is still
 * something we should reject explicitly rather than crashing the
 * supervisor with a TypeError.
 */
export function isUpMessage(value: unknown): value is UpMessage {
    if (typeof value !== 'object' || value === null) return false;
    const t = (value as { type?: unknown }).type;
    return typeof t === 'string' && [
        'ready',
        'connected',
        'disconnected',
        'session_started',
        'session_ended',
        'meter_tick',
        'connector_status',
        'error',
        'pong',
    ].includes(t);
}

export function isDownMessage(value: unknown): value is DownMessage {
    if (typeof value !== 'object' || value === null) return false;
    const t = (value as { type?: unknown }).type;
    return typeof t === 'string' && [
        'init',
        'plug_in',
        'start_charging',
        'stop_charging',
        'pause_charging',
        'resume_charging',
        'plug_out',
        'emergency_stop',
        'set_phase_mode',
        'set_dc_profile',
        'fault',
        'ping',
        'shutdown',
    ].includes(t);
}
