import { afterEach, describe, expect, it } from 'vitest';
import {
    ocppActiveDevices,
    ocppActiveSessions,
    ocppCallErrorsTotal,
    ocppCallLatencySeconds,
    ocppCallTotal,
    ocppFramesTotal,
    ocppSessionDurationSeconds,
    ocppSessionEnergyWh,
    registry,
    renderMetrics,
    resetMetrics,
} from './metrics.js';

describe('metrics', () => {
    afterEach(() => resetMetrics());

    it('exposes the registry in Prometheus text format', async () => {
        ocppCallTotal.inc({ action: 'BootNotification', direction: 'out', device_type: 'AC' });
        const body = await renderMetrics();
        expect(body).toMatch(/ocpp_call_total{action="BootNotification",direction="out",device_type="AC"} 1/);
    });

    it('Counter increments and exports cumulative value', async () => {
        ocppCallTotal.inc({ action: 'Heartbeat', direction: 'out', device_type: 'AC' });
        ocppCallTotal.inc({ action: 'Heartbeat', direction: 'out', device_type: 'AC' });
        const body = await renderMetrics();
        expect(body).toMatch(/ocpp_call_total{action="Heartbeat",direction="out",device_type="AC"} 2/);
    });

    it('Histogram observes record samples in buckets', async () => {
        ocppCallLatencySeconds.observe({ action: 'MeterValues', device_type: 'DC' }, 0.123);
        ocppCallLatencySeconds.observe({ action: 'MeterValues', device_type: 'DC' }, 0.456);
        const body = await renderMetrics();
        expect(body).toMatch(/ocpp_call_latency_seconds_count{action="MeterValues",device_type="DC"} 2/);
    });

    it('Gauge set + dec/inc behave correctly', async () => {
        ocppActiveDevices.set({ state: 'online' }, 0);
        ocppActiveDevices.set({ state: 'offline' }, 0);
        ocppActiveDevices.set({ state: 'online' }, 5);
        ocppActiveDevices.inc({ state: 'online' });
        ocppActiveDevices.dec({ state: 'online' }, 2);
        const body = await renderMetrics();
        expect(body).toMatch(/ocpp_active_devices{state="online"} 4/);
    });

    it('default Node.js metrics are present (with our prefix)', async () => {
        const body = await renderMetrics();
        expect(body).toMatch(/ocpp_sim_process_cpu_user_seconds_total/);
        expect(body).toMatch(/ocpp_sim_nodejs_eventloop_lag_seconds/);
    });

    it('error counter labels include error_code', async () => {
        ocppCallErrorsTotal.inc({ action: 'Authorize', error_code: 'GenericError' });
        ocppCallErrorsTotal.inc({ action: 'StartTransaction', error_code: 'Timeout' });
        const body = await renderMetrics();
        expect(body).toMatch(
            /ocpp_call_errors_total{action="Authorize",error_code="GenericError"} 1/,
        );
        expect(body).toMatch(
            /ocpp_call_errors_total{action="StartTransaction",error_code="Timeout"} 1/,
        );
    });

    it('frame counter discriminates direction + frame_type', async () => {
        ocppFramesTotal.inc({ direction: 'in', frame_type: 'CALLRESULT' });
        ocppFramesTotal.inc({ direction: 'in', frame_type: 'CALLRESULT' });
        ocppFramesTotal.inc({ direction: 'out', frame_type: 'CALL' });
        const body = await renderMetrics();
        expect(body).toMatch(/ocpp_frames_total{direction="in",frame_type="CALLRESULT"} 2/);
        expect(body).toMatch(/ocpp_frames_total{direction="out",frame_type="CALL"} 1/);
    });

    it('session histograms accept duration + energy', async () => {
        ocppSessionDurationSeconds.observe({ device_type: 'AC', end_reason: 'Local' }, 1234);
        ocppSessionEnergyWh.observe({ device_type: 'AC' }, 5500);
        ocppActiveSessions.inc({ device_type: 'AC' });
        ocppActiveSessions.dec({ device_type: 'AC' });
        const body = await renderMetrics();
        expect(body).toMatch(
            /ocpp_session_duration_seconds_count{device_type="AC",end_reason="Local"} 1/,
        );
        expect(body).toMatch(/ocpp_session_energy_wh_count{device_type="AC"} 1/);
        expect(body).toMatch(/ocpp_active_sessions{device_type="AC"} 0/);
    });

    it('contentType is the Prometheus text format', () => {
        expect(registry.contentType).toMatch(/text\/plain.*version=0\.0\.4/);
    });
});
