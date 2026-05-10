# OCPP Charge-Point Simulator

A device-first OCPP 1.6J charge-point simulator. Multi-device, lightweight, type-safe end-to-end.

A five-package npm workspace:

- `@ocpp-sim/core` — pure TS: zod-validated wire codecs, domain types, AC phase + DC SoC simulation models.
- `@ocpp-sim/server` — Fastify + ws + better-sqlite3. One device, one OCPP client, one tick loop.
- `@ocpp-sim/web` — Vite + React + Tailwind + shadcn-style UI + TanStack Query + zustand.
- `@ocpp-sim/csms` — programmable mock CSMS used by tests (and by the conformance runner).
- `@ocpp-sim/conformance` — declarative OCPP 1.6 conformance cases that run a real Simulator against a MockCsms and assert spec-correct behaviour.

## Quick start

```sh
npm install
OCPP_URL=ws://localhost:19000 npm run dev:server &
npm run dev:web
```

Server: <http://localhost:3001> · Web: <http://localhost:5173>

## Tests

```sh
npm test
```

## Observability (optional)

The server exposes `/metrics` in Prometheus text format. Bring up Prometheus + Grafana with the prebuilt dashboard:

```sh
docker compose up -d
```

- Prometheus → <http://localhost:9090>
- Grafana → <http://localhost:3000> (admin / admin), pre-provisioned with an *OCPP Simulator — Overview* dashboard showing CALL rate, p99 latency, errors, frame throughput, and active devices/sessions.

The simulator runs on the host (`npm run dev:server`); only Prometheus and Grafana run in containers. They scrape `host.docker.internal:3001/metrics` so the dev loop stays fast.

## Benchmarks

The `/benchmark` page in the web UI runs configurable load scenarios (presets: Smoke, Steady, Step ramp, plus a fully custom form) against the configured OCPP gateway. While a run is going, live counters stream over the WebSocket; on completion, the run is persisted in SQLite.

Click a run in the History tab to open `/benchmark/runs/:id` — a detail page with the scenario summary plus six Grafana panels (CALL rate, p99 latency, errors/sec, frame throughput, active sessions, online devices) **embedded as iframes scoped to the run's time window**. Bring the Compose stack up first; Grafana is configured for embedding via `GF_SECURITY_ALLOW_EMBEDDING=true`.

## Conformance

`@ocpp-sim/conformance` ships a declarative OCPP 1.6 test suite covering **all six profiles** — each case spins up a fresh `MockCsms` + `Simulator` pair, exercises one OCPP scenario, and asserts spec-correct behaviour.

| Profile | Cases | Examples |
|---|---|---|
| Core | 20 | BootNotification payload; Status sequence; GetConfiguration; Authorize gating; ChangeAvailability; Reset Soft/Hard; UnlockConnector; DataTransfer; TriggerMessage |
| SmartCharging | 7 | SetChargingProfile install/clear; GetCompositeSchedule round-trip; ChargePointMaxProfile cap clamps live MeterValues |
| RemoteTrigger | 3 | MeterValues + BootNotification re-emit; unknown trigger → NotImplemented |
| Reservation | 7 | ReserveNow → Reserved; Occupied/Unavailable paths; CancelReservation; idTag binding |
| LocalAuthListManagement | 8 | SendLocalList Full + Differential; VersionMismatch; LocalPreAuthorize routes around CSMS |
| FirmwareManagement | 4 | UpdateFirmware Downloading→Installed walk; GetDiagnostics filename; trigger arms |

```sh
npm --workspace @ocpp-sim/conformance run test
# or, the CI alias:
npm run conformance
```

The CI script exits non-zero on any failure, ready to drop into a CSMS team's pipeline. Cases are plain data so a future SPA-side runner reads the same arrays:

```ts
import { ALL_CASES, runConformanceSuite } from '@ocpp-sim/conformance';
const result = await runConformanceSuite(ALL_CASES);
console.log(`${result.passed}/${result.cases.length} passed`);
```

The SPA exposes the same suite at **/conformance** with a Run button, per-profile sections, and per-case error pre-blocks on failure.

## Deploy

A multi-stage `Dockerfile` at the repo root produces one image that runs the server **and** serves the built web bundle on a single port.

```sh
docker build -t ocpp-sim .
docker run --rm -d -p 3001:3001 \
    -v ocpp-sim-data:/data \
    -e OCPP_URL=ws://gateway.example:19000 \
    -e AUTH_TOKEN=$(openssl rand -hex 32) \
    --name ocpp-sim ocpp-sim
```

UI + API at <http://localhost:3001>; SQLite persists to the named volume.

### Environment variables

| Var | Default (image) | Default (dev) | Notes |
|---|---|---|---|
| `PORT` | `3001` | `3001` | HTTP/WS listen port |
| `HOST` | `0.0.0.0` | `127.0.0.1` | Bind address. Dev defaults to loopback so a fresh checkout doesn't expose itself on the LAN. |
| `OCPP_URL` | `ws://localhost:19000` | same | Default gateway for new devices. The Settings page persists overrides. |
| `DB_PATH` | `/data/sim.sqlite` | `./data/sim.sqlite` | SQLite file. The Docker volume keeps it across restarts. |
| `AUTH_TOKEN` | unset | unset | When set, every `/api/*` and `/metrics` request needs `Authorization: Bearer <token>`. `/api/health` stays open for health probes. |
| `WEB_DIST_DIR` | `/app/packages/web/dist` | unset | Directory the server hands to fastify-static. Set automatically inside the image; leave unset in dev (Vite serves the SPA on `:5173`). |
| `TLS_INSECURE` | unset | unset | Set to `1` to skip TLS certificate verification on `wss://` upgrades — only for self-signed dev/staging CSMSes. Never enable in production. |

### Auth

`AUTH_TOKEN` is a single shared secret. It gates the REST API, the WebSocket pub/sub, and `/metrics`. `/api/health` and `/api/auth/ping` stay open so external probes (and the SPA login flow) don't need credentials. The web UI shows a sign-in screen when the backend reports `authRequired`, stores the token in `localStorage`, and attaches it to every REST and WS request. Clients that can't set headers (browser WS) can pass the token via `?token=` query param or a `bearer.<token>` subprotocol.

### OCPP gateway auth

OCPP 1.6 §17.4 lets a charge point present `Authorization: Basic base64(deviceId:password)` on the WebSocket upgrade. Set a per-device `authPassword` from the **Edit device** dialog (or `POST /api/devices` body) and the simulator includes it on every connect. Empty / unset = anonymous (the dev-default for most local gateways).

For TLS-terminated CSMSes, point `OCPP_URL` at `wss://…`. The `ws` library handles the TLS upgrade; if the CSMS uses a self-signed cert, set `TLS_INSECURE=1` (dev only).

### Reverse proxy

The server speaks plain HTTP and WS. For TLS, a public hostname, or auth that the SPA can speak: front it with nginx / Caddy / Traefik and forward `/` (HTTP) plus `/api/ws` (WebSocket upgrade) to the container.
