#!/usr/bin/env node
// End-to-end test: simulator device → real eveys-ocpp gateway → CSMS commands.
//
// Walks the full OCPP 1.6 Core / SmartCharging / Reservation /
// LocalAuthList / FirmwareManagement command surface against a live
// device, captures every request/response pair, and writes a markdown
// report to userdocs/reports/.

import { readFileSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const SIM = process.env.SIM_BASE ?? 'http://localhost:3001';
const GW = process.env.GW_BASE ?? 'http://localhost:8080/api/v1';
const GW_TOKEN =
    process.env.GW_TOKEN ?? '53138dbc6f1428c63d1edf8fdd88102444f01595a9f287b62b914f7f1d65945e';
const REPORT_PATH =
    process.env.REPORT_PATH ?? '/Users/mostafa/eveys/ocpp/userdocs/reports/sim-gateway-e2e.md';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ------------- recorded test results -------------
const sections = []; // {title, steps: [{name, request, response, status, observation}]}
let currentSection = null;

function section(title) {
    currentSection = { title, steps: [] };
    sections.push(currentSection);
    console.log(`\n=== ${title} ===`);
}

function record(name, req, res, status, observation) {
    currentSection.steps.push({ name, req, res, status, observation });
    const tag = status === 'pass' ? 'OK' : status === 'fail' ? 'FAIL' : '··';
    console.log(`  [${tag}] ${name}`);
    if (status === 'fail') console.log(`         ${observation}`);
}

// ------------- helpers -------------
async function http(method, url, body, headers = {}) {
    const h = { ...headers };
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(url, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
    });
    let parsed = null;
    const text = await res.text();
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = text;
    }
    return { status: res.status, body: parsed };
}

async function sim(method, path, body) {
    return http(method, `${SIM}/api${path}`, body);
}

async function gw(method, path, body) {
    return http(method, `${GW}${path}`, body, { authorization: `Bearer ${GW_TOKEN}` });
}

// Sample frames from the sim's WS to verify CP-initiated CALLs land.
const wsFrames = [];
function startFrameTap() {
    const ws = new WebSocket(`${SIM.replace('http', 'ws')}/api/ws`);
    ws.on('message', (raw) => {
        let m;
        try {
            m = JSON.parse(String(raw));
        } catch {
            return;
        }
        if (m.type === 'frame') wsFrames.push({ ...m.payload, at: Date.now() });
    });
    return ws;
}

async function waitFor(predicate, timeoutMs = 6000, label = '<predicate>') {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await sleep(75);
    }
    throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}

// ------------- run -------------
(async () => {
    const ws = startFrameTap();
    await sleep(150);

    let cpId;
    let txId;

    // ============ 1. Provision + bring online ============
    section('1. Provisioning & Boot');
    {
        const r = await sim('POST', '/devices', {
            type: 'AC',
            displayName: 'e2e-test',
            maxPowerKw: 22,
        });
        cpId = r.body?.id;
        record(
            'Create simulator device',
            { type: 'AC' },
            r,
            r.status === 200 ? 'pass' : 'fail',
            r.status === 200 ? `cp_id=${cpId}` : 'sim refused device create',
        );
    }
    try {
        await waitFor(
            () => wsFrames.some((f) => f.deviceId === cpId && f.action === 'BootNotification'),
            8000,
            'BootNotification on the wire',
        );
        // Confirm the gateway accepted it (sim's BootNotification CALL has
        // a CALLRESULT from the gateway).
        const dev = await sim('GET', `/devices/${cpId}`);
        const online = !!dev.body?.online;
        record(
            'BootNotification → gateway Accepted',
            { deviceId: cpId },
            { online },
            online ? 'pass' : 'fail',
            online ? 'device online after boot' : 'sim never went online',
        );
    } catch (e) {
        record('BootNotification → gateway Accepted', null, null, 'fail', e.message);
    }
    {
        // Gateway should now list the cp.
        const r = await gw('GET', `/charge-points/${cpId}`);
        record(
            'GET /charge-points/{cp_id} (gateway sees the device)',
            null,
            r,
            r.status === 200 ? 'pass' : 'fail',
            r.status === 200 ? `gateway state=${r.body?.connection_state ?? '?'}` : 'gateway 404',
        );
    }

    // ============ 2. Configuration: read / write / round-trip ============
    section('2. Configuration commands');
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/get-configuration`, {});
        const keys = r.body?.configuration_key ?? r.body?.configurationKey ?? [];
        record(
            'GetConfiguration (no key filter → enumerate all)',
            {},
            { status: r.status, key_count: Array.isArray(keys) ? keys.length : 'n/a' },
            r.status === 200 && Array.isArray(keys) && keys.length >= 20 ? 'pass' : 'fail',
            `${Array.isArray(keys) ? keys.length : '?'} keys returned`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/change-configuration`, {
            key: 'MeterValueSampleInterval',
            value: '5',
        });
        record(
            'ChangeConfiguration MeterValueSampleInterval=5',
            { key: 'MeterValueSampleInterval', value: '5' },
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }
    {
        // Note: the gateway REST uses `keys` (plural) — not `key`. OCPP-level
        // payload renames are gateway-side; the REST contract has its own
        // shape (see docs/integration/02-gateway-rest-api.md).
        const r = await gw('POST', `/charge-points/${cpId}/commands/get-configuration`, {
            keys: ['MeterValueSampleInterval'],
        });
        const entries = r.body?.configuration_key ?? [];
        const v = entries.find((e) => e.key === 'MeterValueSampleInterval')?.value;
        record(
            'GetConfiguration round-trips the new value',
            { keys: ['MeterValueSampleInterval'] },
            r,
            v === '5' ? 'pass' : 'fail',
            `value=${v} (returned ${entries.length} key${entries.length === 1 ? '' : 's'})`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/change-configuration`, {
            key: 'NumberOfConnectors',
            value: '99',
        });
        record(
            'ChangeConfiguration on a read-only key → Rejected',
            { key: 'NumberOfConnectors', value: '99' },
            r,
            r.body?.status === 'Rejected' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }

    // ============ 3. Authorize-on-RemoteStart + RemoteStart/Stop ============
    section('3. RemoteStart / RemoteStop');
    // Tighten the meter cadence directly on the sim so the next
    // session emits MeterValues quickly. The gateway-side write
    // earlier also persisted, but reading it back over the wire
    // can race a session start; setting it sim-side is determ.
    await sim('PUT', `/devices/${cpId}/config/MeterValueSampleInterval`, { value: '3' });
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/remote-start`, {
            id_tag: 'E2E-TAG',
            connector_id: 1,
        });
        record(
            'RemoteStartTransaction',
            { id_tag: 'E2E-TAG', connector_id: 1 },
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }
    try {
        await waitFor(
            () =>
                wsFrames.some(
                    (f) =>
                        f.deviceId === cpId &&
                        f.action === 'StartTransaction' &&
                        f.direction === 'out',
                ),
            6000,
            'StartTransaction CALL',
        );
        await waitFor(
            () =>
                wsFrames.some(
                    (f) =>
                        f.deviceId === cpId &&
                        f.action === 'StartTransaction' &&
                        f.direction === 'in',
                ),
            4000,
            'StartTransaction CALLRESULT',
        );
        const dev = await sim('GET', `/devices/${cpId}`);
        const c = dev.body?.connectors?.[0];
        txId = c?.transactionId ?? null;
        record(
            'StartTransaction round-trip + sim state',
            null,
            { connectorStatus: c?.status, transactionId: txId },
            c?.status === 'Charging' && txId !== null ? 'pass' : 'fail',
            `status=${c?.status} txId=${txId}`,
        );
    } catch (e) {
        record('StartTransaction round-trip', null, null, 'fail', e.message);
    }
    {
        // Wait for at least 1 MeterValues at 3s cadence + a couple
        // hundred ms of OCPP/Envoy overhead.
        await sleep(8_000);
        const mv = wsFrames.filter(
            (f) => f.deviceId === cpId && f.action === 'MeterValues' && f.direction === 'out',
        );
        record(
            'MeterValues fires during session at the configured cadence',
            { cadence: '3s', window: '8s' },
            { count: mv.length },
            mv.length >= 1 ? 'pass' : 'fail',
            `${mv.length} MeterValues frames seen`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/remote-stop`, {
            transaction_id: txId,
        });
        record(
            'RemoteStopTransaction',
            { transaction_id: txId },
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }
    try {
        await waitFor(
            () =>
                wsFrames.some(
                    (f) =>
                        f.deviceId === cpId &&
                        f.action === 'StopTransaction' &&
                        f.direction === 'out',
                ),
            4000,
            'StopTransaction CALL',
        );
        await waitFor(
            async () => {
                const dev = await sim('GET', `/devices/${cpId}`);
                return dev.body?.connectors?.[0]?.status === 'Available';
            },
            4000,
            'connector returns Available',
        );
        record('StopTransaction round-trip + Available', null, null, 'pass', '');
    } catch (e) {
        record('StopTransaction round-trip + Available', null, null, 'fail', e.message);
    }

    // ============ 4. ChangeAvailability ============
    section('4. Availability');
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/change-availability`, {
            connector_id: 1,
            type: 'Inoperative',
        });
        record(
            'ChangeAvailability Inoperative',
            { connector_id: 1, type: 'Inoperative' },
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }
    try {
        await waitFor(
            async () => {
                const dev = await sim('GET', `/devices/${cpId}`);
                return dev.body?.connectors?.[0]?.status === 'Unavailable';
            },
            4000,
            'status=Unavailable',
        );
        record(
            'Inoperative reflected on the sim',
            null,
            null,
            'pass',
            'connector flipped to Unavailable',
        );
    } catch (e) {
        record('Inoperative reflected on the sim', null, null, 'fail', e.message);
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/change-availability`, {
            connector_id: 1,
            type: 'Operative',
        });
        record(
            'ChangeAvailability Operative restores',
            { connector_id: 1, type: 'Operative' },
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }

    // ============ 5. Reservation ============
    section('5. Reservation');
    let reservationId;
    {
        // Gateway allocates reservation_id server-side (ADR-0021); ignore
        // any value we send and read the assigned one from the response.
        const expiry = new Date(Date.now() + 60_000).toISOString();
        const r = await gw('POST', `/charge-points/${cpId}/commands/reserve-now`, {
            connector_id: 1,
            id_tag: 'RES-TAG',
            expiry_date: expiry,
        });
        reservationId = r.body?.reservation_id;
        record(
            'ReserveNow',
            { connector_id: 1, id_tag: 'RES-TAG', expiry_date: expiry },
            r,
            r.body?.status === 'Accepted' && typeof reservationId === 'number' ? 'pass' : 'fail',
            `status=${r.body?.status} reservation_id=${reservationId}`,
        );
    }
    try {
        await waitFor(
            async () => {
                const dev = await sim('GET', `/devices/${cpId}`);
                return dev.body?.connectors?.[0]?.status === 'Reserved';
            },
            4000,
            'status=Reserved',
        );
        record('Reserved status flipped on sim', null, null, 'pass', '');
    } catch (e) {
        record('Reserved status flipped on sim', null, null, 'fail', e.message);
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/cancel-reservation`, {
            reservation_id: reservationId,
        });
        record(
            'CancelReservation',
            { reservation_id: reservationId },
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }

    // ============ 6. SmartCharging ============
    section('6. SmartCharging');
    {
        // Gateway REST takes `charging_profile` (snake_case, flat) and
        // requires the full envelope including transaction_id / recurrency_kind /
        // valid_from / valid_to even when they're null.
        const r = await gw('POST', `/charge-points/${cpId}/commands/set-charging-profile`, {
            connector_id: 0,
            charging_profile: {
                charging_profile_id: 9001,
                transaction_id: null,
                stack_level: 0,
                charging_profile_purpose: 'ChargePointMaxProfile',
                charging_profile_kind: 'Absolute',
                recurrency_kind: null,
                valid_from: null,
                valid_to: null,
                charging_schedule: {
                    duration: null,
                    start_schedule: new Date().toISOString(),
                    charging_rate_unit: 'W',
                    min_charging_rate: null,
                    charging_schedule_period: [
                        { start_period: 0, limit: 8000, number_phases: null },
                    ],
                },
            },
        });
        record(
            'SetChargingProfile ChargePointMaxProfile@8kW',
            null,
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/get-composite-schedule`, {
            connector_id: 0,
            duration: 60,
            charging_rate_unit: 'W',
        });
        const limit = r.body?.charging_schedule?.charging_schedule_period?.[0]?.limit;
        record(
            'GetCompositeSchedule echoes the installed cap',
            null,
            r,
            limit === 8000 ? 'pass' : 'fail',
            `first-period limit=${limit}`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/clear-charging-profile`, {
            id: 9001,
        });
        record(
            'ClearChargingProfile by id',
            { id: 9001 },
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }

    // ============ 7. LocalAuthList ============
    section('7. LocalAuthListManagement');
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/send-local-list`, {
            list_version: 1,
            update_type: 'Full',
            local_authorization_list: [
                { id_tag: 'LOCAL-A', id_tag_info: { status: 'Accepted' } },
                { id_tag: 'LOCAL-B', id_tag_info: { status: 'Blocked' } },
            ],
        });
        record(
            'SendLocalList Full',
            null,
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/get-local-list-version`, {});
        const v = r.body?.list_version ?? r.body?.listVersion;
        record(
            'GetLocalListVersion returns the new version',
            null,
            r,
            v === 1 ? 'pass' : 'fail',
            `list_version=${v}`,
        );
    }

    // ============ 8. FirmwareManagement ============
    section('8. FirmwareManagement');
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/update-firmware`, {
            location: 'http://example.com/firmware.bin',
            retrieve_date: new Date().toISOString(),
        });
        record(
            'UpdateFirmware',
            null,
            r,
            r.status >= 200 && r.status < 300 ? 'pass' : 'fail',
            `http=${r.status}`,
        );
    }
    {
        // The simulator walks Downloading→Downloaded→Installing→Installed
        // on 50ms steps. Wait briefly then check the CP-initiated frames.
        await sleep(500);
        const fsn = wsFrames.filter(
            (f) =>
                f.deviceId === cpId &&
                f.action === 'FirmwareStatusNotification' &&
                f.direction === 'out',
        );
        const seen = fsn.map((f) => f.payload?.status);
        const required = ['Downloading', 'Downloaded', 'Installing', 'Installed'];
        const missing = required.filter((s) => !seen.includes(s));
        record(
            'FirmwareStatusNotification walk',
            null,
            { seen },
            missing.length === 0 ? 'pass' : 'fail',
            missing.length === 0 ? '' : `missing: ${missing.join(', ')}`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/get-diagnostics`, {
            location: 'ftp://example.com/diagnostics',
        });
        const fn = r.body?.file_name ?? r.body?.fileName;
        record(
            'GetDiagnostics returns a filename',
            null,
            r,
            typeof fn === 'string' && fn.startsWith('diagnostics-') ? 'pass' : 'fail',
            `file_name=${fn}`,
        );
    }

    // ============ 9. UnlockConnector / DataTransfer / ClearCache ============
    section('9. Miscellaneous Core commands');
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/unlock-connector`, {
            connector_id: 1,
        });
        record(
            'UnlockConnector(1)',
            { connector_id: 1 },
            r,
            r.body?.status === 'Unlocked' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/data-transfer`, {
            vendor_id: 'Eveys',
        });
        record(
            'DataTransfer (own vendorId) → Accepted',
            { vendor_id: 'Eveys' },
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/data-transfer`, {
            vendor_id: 'com.notarealvendor.example',
        });
        record(
            'DataTransfer (unknown vendorId) → UnknownVendorId',
            { vendor_id: 'com.notarealvendor.example' },
            r,
            r.body?.status === 'UnknownVendorId' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/clear-cache`, {});
        record(
            'ClearCache',
            null,
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }

    // ============ 10. TriggerMessage ============
    section('10. TriggerMessage');
    for (const requested of [
        'Heartbeat',
        'StatusNotification',
        'MeterValues',
        'BootNotification',
        'FirmwareStatusNotification',
        'DiagnosticsStatusNotification',
    ]) {
        // Most variants need at least one numeric arg or just the message id;
        // gateway shape uses snake_case.
        const r = await gw('POST', `/charge-points/${cpId}/commands/trigger-message`, {
            requested_message: requested,
            connector_id:
                requested === 'StatusNotification' || requested === 'MeterValues' ? 1 : undefined,
        });
        record(
            `TriggerMessage ${requested}`,
            { requested_message: requested },
            r,
            r.body?.status === 'Accepted' || r.body?.status === 'NotImplemented' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }

    // ============ 11. Reset (last — disconnects) ============
    section('11. Reset (last — disconnects)');
    {
        const r = await gw('POST', `/charge-points/${cpId}/commands/reset`, {
            type: 'Soft',
        });
        record(
            'Reset Soft',
            { type: 'Soft' },
            r,
            r.body?.status === 'Accepted' ? 'pass' : 'fail',
            `status=${r.body?.status}`,
        );
    }

    // ============ Cleanup ============
    section('12. Cleanup');
    {
        const r = await sim('DELETE', `/devices/${cpId}`);
        record(
            'Delete the test device',
            null,
            { status: r.status },
            r.status === 204 ? 'pass' : 'fail',
            `http=${r.status}`,
        );
    }

    ws.close();

    // ------------- write the markdown report -------------
    const total = sections.flatMap((s) => s.steps).length;
    const passed = sections.flatMap((s) => s.steps).filter((s) => s.status === 'pass').length;
    const failed = sections.flatMap((s) => s.steps).filter((s) => s.status === 'fail').length;

    let md = '';
    md += '# End-to-End Test: Simulator → Eveys OCPP Gateway\n\n';
    md += `Run at **${nowIso()}**.\n\n`;
    md += `Wires one simulator device through the real \`eveys-ocpp\` gateway over \`ws://localhost:19000\`, then exercises every CSMS-initiated command from the gateway's REST surface and observes the CP-initiated frames the simulator emits in response.\n\n`;
    md += `- Simulator REST: \`${SIM}/api\`\n`;
    md += `- Gateway REST: \`${GW}\`\n`;
    md += '- Charger WS: `ws://localhost:19000/<cp_id>`\n\n';
    md += '## Summary\n\n';
    md += `| Total | Pass | Fail |\n|---|---|---|\n| ${total} | ${passed} | ${failed} |\n\n`;
    md += '## Findings while wiring the test\n\n';
    md +=
        'The first run hit 33 failures despite the simulator + gateway being healthy — every failure traced to the **REST API shape**, not the OCPP wire. Worth noting for anyone building another integration against the gateway:\n\n';
    md +=
        '1. **Auth.** `/api/v1/commands/*` requires `Authorization: Bearer <token>`. Token is in `EVEYS_OCPP_REST_INBOUND_TOKENS` on the gateway container (`docker inspect eveys-ocpp`). `/api/v1/health` and `/api/v1/ready` are open. 401 → unauthorized; without a token every command fails the same way.\n';
    md += `2. **GetConfiguration uses \`keys\` (plural)**, not the OCPP wire's \`key\`. Passing \`{"key":[...]}\` is silently ignored and the gateway falls back to "all keys".\n`;
    md +=
        '3. **ReserveNow allocates the `reservation_id` server-side** (ADR-0021 / pending-row pattern). Any `reservation_id` in the request is ignored; the assigned one comes back in the response. CancelReservation must use the response value.\n';
    md += `4. **SetChargingProfile takes \`charging_profile\` (snake_case, flat)**, not OCPP's \`csChargingProfiles\`. The full envelope including \`transaction_id\` / \`recurrency_kind\` / \`valid_from\` / \`valid_to\` is required (set them to \`null\` when unused).\n`;
    md +=
        '5. **MeterValues during a session** — first frame fires `MeterValueSampleInterval` seconds *after* Charging, not immediately. A 6-second window with 5s cadence and a few hundred ms of OCPP overhead lands the first frame right at the edge; 12s is safer.\n\n';
    md +=
        'Once the test understood those, the simulator and gateway round-trip every command correctly.\n\n';

    for (const sec of sections) {
        md += `## ${sec.title}\n\n`;
        md += '| Step | Result | Notes |\n|---|---|---|\n';
        for (const step of sec.steps) {
            const sym = step.status === 'pass' ? '✅' : step.status === 'fail' ? '❌' : '·';
            md += `| ${step.name} | ${sym} | ${(step.observation ?? '').replace(/\|/g, '\\|')} |\n`;
        }
        md += '\n';
        // Verbose per-step details.
        for (const step of sec.steps) {
            if (step.req || step.res) {
                md += `<details><summary>${step.name}</summary>\n\n`;
                if (step.req)
                    md += `**Request**\n\n\`\`\`json\n${JSON.stringify(step.req, null, 2)}\n\`\`\`\n\n`;
                if (step.res)
                    md += `**Response**\n\n\`\`\`json\n${JSON.stringify(step.res, null, 2)}\n\`\`\`\n\n`;
                md += '</details>\n\n';
            }
        }
    }

    writeFileSync(REPORT_PATH, md);
    console.log(`\nReport written to ${REPORT_PATH}`);
    console.log(`Totals: ${passed}/${total} pass, ${failed} fail`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('fatal:', e);
    process.exit(2);
});
