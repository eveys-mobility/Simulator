import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isDownMessage, isUpMessage, DownMessage, UpMessage } from './protocol';

describe('protocol — type guards', () => {
    test('valid Down messages all pass isDownMessage', () => {
        const samples: DownMessage[] = [
            { type: 'init', cp_id: 'cp_a1', cp_type: 'AC', ocpp_url: 'ws://x' },
            { type: 'plug_in', connector_id: 1, id_tag: 'T1' },
            { type: 'start_charging', connector_id: 1 },
            { type: 'stop_charging', connector_id: 1 },
            { type: 'stop_charging', connector_id: 1, reason: 'Local' },
            { type: 'pause_charging', connector_id: 1 },
            { type: 'resume_charging', connector_id: 1 },
            { type: 'plug_out', connector_id: 1 },
            { type: 'emergency_stop', connector_id: 1 },
            { type: 'set_phase_mode', mode: 'balanced' },
            { type: 'set_dc_profile', profile: { capacity_kwh: 60 } },
            { type: 'fault', connector_id: 1 },
            { type: 'fault', connector_id: 1, clear_after_seconds: 5 },
            { type: 'ping', nonce: 42 },
            { type: 'shutdown' },
        ];
        for (const m of samples) assert.ok(isDownMessage(m), `expected pass: ${JSON.stringify(m)}`);
    });

    test('valid Up messages all pass isUpMessage', () => {
        const samples: UpMessage[] = [
            { type: 'ready' },
            { type: 'connected' },
            { type: 'disconnected' },
            { type: 'session_started', connector_id: 1, transaction_id: 42, id_tag: 'T1' },
            { type: 'session_ended', connector_id: 1, transaction_id: 42, energy_wh: 1000, peak_power_kw: 22, reason: 'Local' },
            { type: 'meter_tick', connector_id: 1, power_kw: 11.5, energy_kwh: 0.5 },
            { type: 'meter_tick', connector_id: 1, power_kw: 50, energy_kwh: 0.7, soc_pct: 22 },
            { type: 'connector_status', connector_id: 1, status: 'Charging' },
            { type: 'error', level: 'warn', message: 'flaky network' },
            { type: 'pong', nonce: 42 },
        ];
        for (const m of samples) assert.ok(isUpMessage(m), `expected pass: ${JSON.stringify(m)}`);
    });

    test('garbage rejected as either direction', () => {
        for (const bad of [null, undefined, 0, '', [], {}, { type: 'bogus' }, { type: 42 }]) {
            assert.equal(isDownMessage(bad), false, `expected reject: ${JSON.stringify(bad)}`);
            assert.equal(isUpMessage(bad), false, `expected reject: ${JSON.stringify(bad)}`);
        }
    });

    test('round-trip JSON serialization preserves classification', () => {
        const downSamples: DownMessage[] = [
            { type: 'init', cp_id: 'cp_b2', cp_type: 'DC', ocpp_url: 'ws://x', dc_profile: { capacity_kwh: 60, charger_max_kw: 100 } },
            { type: 'set_phase_mode', mode: 'imbalanced' },
        ];
        for (const m of downSamples) {
            const wire = JSON.parse(JSON.stringify(m));
            assert.ok(isDownMessage(wire));
            assert.deepEqual(wire, m);
        }
    });

    test('Down/Up types do not cross-classify', () => {
        const ready: UpMessage = { type: 'ready' };
        const init: DownMessage = { type: 'init', cp_id: 'cp_c3', cp_type: 'AC', ocpp_url: 'ws://x' };
        assert.equal(isDownMessage(ready), false);
        assert.equal(isUpMessage(init), false);
    });
});
