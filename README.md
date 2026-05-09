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
