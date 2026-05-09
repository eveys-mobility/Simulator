# OCPP Charge-Point Simulator

A device-first OCPP 1.6J charge-point simulator. Multi-device, lightweight, type-safe end-to-end.

The codebase lives under [`v2/`](./v2) as a three-package npm workspace:

- `@ocpp-sim/core` — pure TS: zod-validated wire codecs, domain types, AC phase + DC SoC simulation models.
- `@ocpp-sim/server` — Fastify + ws + better-sqlite3. One device, one OCPP client, one tick loop.
- `@ocpp-sim/web` — Vite + React + Tailwind + shadcn-style UI + TanStack Query + zustand.

## Quick start

```sh
cd v2
npm install
OCPP_URL=ws://localhost:19000 npm run dev:server &
npm run dev:web
```

Server: <http://localhost:3001> · Web: <http://localhost:5173>

## Tests

```sh
cd v2
npm test
```

## Observability (optional)

The server exposes `/metrics` in Prometheus text format. Bring up Prometheus + Grafana with the prebuilt dashboard:

```sh
cd v2
docker compose up -d
```

- Prometheus → <http://localhost:9090>
- Grafana → <http://localhost:3000> (admin / admin), pre-provisioned with an *OCPP Simulator — Overview* dashboard showing CALL rate, p99 latency, errors, frame throughput, and active devices/sessions.

The simulator runs on the host (`npm run dev:server`); only Prometheus and Grafana run in containers. They scrape `host.docker.internal:3001/metrics` so the dev loop stays fast.
