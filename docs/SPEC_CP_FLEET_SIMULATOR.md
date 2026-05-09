# Spec: CP Fleet Simulator

Status: proposal — implementation MRs follow acceptance.

A multi-CP fleet simulator that connects to the existing OCPP gateway with **real WebSocket connections per CP**, enabling load testing and group/load-balancer correctness testing without changing the gateway.

## Why

Today's simulator is one CP per Node process. To exercise gateway scenarios that involve more than one charger — group bookings, fleet-level load balancing, fan-out webhook delivery, OCTT cases that span multiple stations — the right shape is a fleet runtime that holds N independent CPs, each with its own OCPP socket.

Two design constraints make this tractable:

1. **The single-CP simulator is already the right unit.** Don't rewrite it; *spawn it* N times.
2. **Use worker threads, not subprocesses.** Worker threads give us per-CP isolation (separate event loop, separate WS connection, separate heap) without 100 × Node startup cost or 3 GB RSS.

## Constraints (locked decisions)

| Decision | Choice | Rationale |
|---|---|---|
| Isolation model | `node:worker_threads` (one thread per CP) | Real WS connections; ~5 MB/CP; 100 CPs ≈ 500 MB |
| Stack on top of | The 5 open MRs (RemoteStart fix → DC) | Don't rewrite the OCPP core |
| AC connectors | Fixed at 1, but architected to extend | Simulation simplification |
| DC connectors | Fixed at 2, but architected to extend | Simulation simplification |
| Persistence | SQLite (`better-sqlite3`) | Concurrency-safe, survives restart |
| UI | Same Vite app, new `/fleet` route | Existing single-CP UI untouched |
| Load balancing v1 | Session-assignment only (round-robin / least-active) | Power-cap distribution = v2 |
| Load balancing v2 | `SetChargingProfile` distribution | Out of MVP scope |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        FLEET-MANAGER                             │
│  (Node main process — port :3100, Express + ws + SQLite)        │
│                                                                  │
│  ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ REST API │  │ WS pub/sub │  │ Registry   │  │ LoadBalancer│ │
│  └──────────┘  └────────────┘  └────────────┘  └─────────────┘ │
│        │             │              │                  │        │
│        └─────────────┴──────────────┴──────────────────┘        │
│                              │                                   │
│                  ┌───────────┴───────────┐                       │
│                  │    WorkerSupervisor   │                       │
│                  └───────────┬───────────┘                       │
│                              │                                   │
│                              ▼                                   │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  CP-WORKER pool (worker_threads, one per CP)             │  │
│   │                                                          │  │
│   │  ┌─────────┐  ┌─────────┐  ┌─────────┐    ┌─────────┐    │  │
│   │  │ CP-001  │  │ CP-002  │  │ CP-003  │ …  │ CP-110  │    │  │
│   │  │ (AC)    │  │ (AC)    │  │ (DC)    │    │         │    │  │
│   │  │  WS ──┐ │  │  WS ──┐ │  │  WS ──┐ │    │  WS ──┐ │    │  │
│   │  └───────┼─┘  └───────┼─┘  └───────┼─┘    └───────┼─┘    │  │
│   └─────────┼────────────┼────────────┼──────────────┼─────┘  │
└─────────────┼────────────┼────────────┼──────────────┼────────┘
              │            │            │              │
              ▼            ▼            ▼              ▼
            ════════════════════════════════════════════════
                        OCPP gateway (ws://:19000)
            ════════════════════════════════════════════════
              ▲
              │
              ▼
    ┌──────────────────────┐
    │   Frontend UI         │
    │   /        ← single   │  ← unchanged from today
    │   /fleet   ← admin    │  ← new in MR-G
    └──────────────────────┘
```

Components and their responsibility boundaries:

- **CP-WORKER**: a worker thread that wraps `ChargePoint` + `TransactionManager` + `AuthorizationManager` from `backend/src/ocpp/`. Holds exactly one OCPP WebSocket. Implements its own meter-tick loop. Sends/receives parent messages over `parentPort`.
- **WorkerSupervisor**: spawns workers, restarts them with exponential backoff, attributes worker crashes to a CP id, terminates them on shutdown.
- **Registry**: in-memory authoritative state for the fleet — every CP, its status, its assigned group, its active session if any. Backed by SQLite snapshots, but reads come from memory.
- **LoadBalancer**: pure function — given (group, request) returns a CP id (or null). Doesn't mutate; the API caller mutates.
- **REST API**: CRUD for groups + CPs + sessions + LB config.
- **WS pub/sub**: broadcasts state changes to UI clients.

## Data model

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ groups          │       │ charge_points   │       │ sessions        │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id (PK)         │   ┌───│ id (PK)         │       │ id (PK)         │
│ name            │   │   │ cp_id (UNIQUE)  │       │ cp_id (FK)      │
│ type ('AC'|'DC')│◄──┘   │ type ('AC'|'DC')│       │ connector_id    │
│ lb_strategy     │       │ group_id (FK)   │◄──────│ id_tag          │
│ lb_enabled      │       │ phase_mode      │       │ status          │
│ created_at      │       │ dc_profile (json)│      │ started_at      │
└─────────────────┘       │ created_at      │       │ ended_at        │
                          └─────────────────┘       │ end_reason      │
                                                    │ energy_wh       │
                                                    │ peak_power_kw   │
                                                    └─────────────────┘
```

SQLite is the *snapshot* layer. Runtime state lives in the registry (in memory). Meter ticks are NOT persisted — they go to the worker's WS, the gateway sees them, gone. Session lifecycle events (start/end) and rolled-up counters are persisted.

DDL for v1:

```sql
CREATE TABLE groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    type        TEXT NOT NULL CHECK (type IN ('AC', 'DC')),
    lb_strategy TEXT NOT NULL DEFAULT 'round_robin' CHECK (lb_strategy IN ('round_robin', 'least_active')),
    lb_enabled  INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE charge_points (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cp_id       TEXT NOT NULL UNIQUE,
    type        TEXT NOT NULL CHECK (type IN ('AC', 'DC')),
    group_id    INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    phase_mode  TEXT,                              -- 'balanced'|'imbalanced'|'single-phase' for AC
    dc_profile  TEXT,                              -- JSON for DC profile
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_charge_points_group ON charge_points(group_id);

CREATE TABLE sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    cp_id         TEXT NOT NULL,
    connector_id  INTEGER NOT NULL,
    id_tag        TEXT NOT NULL,
    status        TEXT NOT NULL,                   -- 'active' | 'completed' | 'aborted'
    started_at    TEXT NOT NULL,
    ended_at      TEXT,
    end_reason    TEXT,
    energy_wh     INTEGER NOT NULL DEFAULT 0,
    peak_power_kw REAL    NOT NULL DEFAULT 0
);

CREATE INDEX idx_sessions_cp ON sessions(cp_id, started_at);
CREATE INDEX idx_sessions_status ON sessions(status);
```

## Worker protocol

Parent and worker speak structured JSON over `parentPort.postMessage`. Tagged-union message types:

```ts
// parent → worker
type DownMessage =
  | { type: 'init',           cp_id: string, cp_type: 'AC'|'DC',
                              ocpp_url: string,
                              phase_mode?: PhaseMode,
                              dc_profile?: DCBatteryProfile }
  | { type: 'plug_in',        connector_id: number, id_tag: string }
  | { type: 'start_charging', connector_id: number }
  | { type: 'stop_charging',  connector_id: number, reason?: string }
  | { type: 'plug_out',       connector_id: number }
  | { type: 'emergency_stop', connector_id: number }
  | { type: 'set_phase_mode', mode: PhaseMode }
  | { type: 'set_dc_profile', profile: Partial<DCBatteryProfile> }
  | { type: 'shutdown' };

// worker → parent
type UpMessage =
  | { type: 'ready' }
  | { type: 'connected'      | 'disconnected' }
  | { type: 'session_started', connector_id: number, transaction_id: number, id_tag: string }
  | { type: 'session_ended',   connector_id: number, transaction_id: number,
                               energy_wh: number, peak_power_kw: number, reason: string }
  | { type: 'meter_tick',      connector_id: number, power_kw: number,
                               energy_kwh: number, soc_pct?: number }   // sampled at 1 Hz
  | { type: 'connector_status',connector_id: number, status: string }
  | { type: 'error',           level: 'warn'|'error', message: string };
```

Notes:

- `meter_tick` is the lightweight UI feed — not OCPP MeterValues. The worker still sends OCPP MeterValues to the gateway on its own cadence. The parent only needs enough to render the fleet dashboard.
- `init` is sent once after worker spawn; the worker won't connect to the gateway until it arrives.
- All messages are routed by worker thread id; the supervisor owns the `worker_id → cp_id` mapping.

## Lifecycle: EV session

State machine per connector (matches OCPP `ChargePointStatus`):

```
                     ┌────────┐
                     │  Idle  │
                     └────┬───┘
                          │ plug_in
                          ▼
                  ┌──────────────┐
                  │  Preparing   │
                  └────┬─────────┘
                       │ start_charging
                       ▼
                  ┌──────────────┐  pause
                  │  Charging    │◄────────────►SuspendedEV
                  └────┬─────────┘
                       │ stop_charging
                       ▼
                  ┌──────────────┐
                  │  Finishing   │
                  └────┬─────────┘
                       │ plug_out
                       ▼
                     ┌────────┐
                     │  Idle  │
                     └────────┘

                       emergency_stop  → Faulted (any state) → manual reset → Idle
```

`emergency_stop` is the only edge that's allowed from any state. It sends `StopTransaction reason=EmergencyStop`, transitions to `Faulted`, requires explicit reset.

## Load balancing (v1: session assignment)

Pure function over the registry:

```ts
function pickCp(group: Group, registry: Registry): string | null {
    const candidates = registry.cps
        .filter(cp => cp.group_id === group.id)
        .filter(cp => cp.status === 'Available' && !cp.has_active_session);
    if (candidates.length === 0) return null;

    if (group.lb_strategy === 'round_robin') {
        // Persist last-picked-index per group; advance on each pick.
        return candidates[(group.lb_round_robin_cursor ?? 0) % candidates.length].cp_id;
    }
    // 'least_active' — break ties with cp_id for determinism
    return candidates.sort((a, b) =>
        a.active_session_count - b.active_session_count || a.cp_id.localeCompare(b.cp_id)
    )[0].cp_id;
}
```

Triggered by `POST /fleet/groups/:id/sessions` (UI action: "start a session somewhere in this group"). If LB is disabled on the group, the request must specify `cp_id` directly; the LB is bypassed.

DC connector picking (within a chosen DC CP) goes for the lower-numbered free connector. This isn't strictly load balancing, but the prompt asks for "session assignment" to be even, so for DC the LB picks the *connector* the same way it picks AC CPs.

## Load balancing (v2 — out of MVP, design hook only)

Power-cap distribution will use `SetChargingProfile`. Hook: a `SiteCapManager` watches every `meter_tick` from the fleet, sums kW within each AC group, and when the sum approaches `group.power_cap_kw` (a future column), issues `SetChargingProfile` to the active sessions to throttle them. This is OCPP-conformant and matches what real fleet EVSEs do. Out of MVP because it requires gateway changes (the gateway must be willing to forward `SetChargingProfile` to a charger and accept the response).

## REST API (fleet manager — port :3100)

```
GET  /fleet/groups                             # list groups
POST /fleet/groups                             # body: {name, type, lb_strategy?, lb_enabled?}
PATCH /fleet/groups/:id                        # body: any updatable field
DELETE /fleet/groups/:id                       # cascades cp.group_id = NULL

GET  /fleet/cps                                # list CPs (filter: ?group_id=)
POST /fleet/cps                                # body: {cp_id, type, group_id?, phase_mode?, dc_profile?}
PATCH /fleet/cps/:cp_id                        # body: any updatable field
DELETE /fleet/cps/:cp_id                       # terminates worker, removes row

POST /fleet/cps/:cp_id/actions/plug-in         # body: {connector_id, id_tag}
POST /fleet/cps/:cp_id/actions/start           # body: {connector_id}
POST /fleet/cps/:cp_id/actions/stop            # body: {connector_id, reason?}
POST /fleet/cps/:cp_id/actions/plug-out        # body: {connector_id}
POST /fleet/cps/:cp_id/actions/emergency-stop  # body: {connector_id}

POST /fleet/groups/:id/sessions                # body: {id_tag} → LB picks a CP
GET  /fleet/sessions                           # filter: ?status=, ?group_id=, ?since=
GET  /fleet/sessions/:id                       # full session record + history
```

All endpoints return `{success, data?, error?}`. Errors carry HTTP 4xx/5xx and a structured `code`.

## WebSocket pub/sub (fleet manager — `/fleet/ws`)

Push channel for the UI. Coalesced events:

- `cp_state` `{cp_id, status, has_active_session}`
- `session_started`/`session_ended` (mirrors the worker `up` messages)
- `meter_summary` — group rollup at 1 Hz: `{group_id, total_kw, active_sessions}`
- `worker_event` — `{cp_id, level, message}`

Per-CP `meter_tick` is *not* broadcast on this channel — the cardinality is too high. The single-CP UI (port :3001) keeps that detail for one CP at a time; the fleet UI subscribes to summaries.

## UI: `/fleet` route

```
┌────────────────────────────────────────────────────────────────────┐
│ Fleet Admin                            [+ New Group]  [+ New CP]  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─ Group: AC-A ─────────────── 100 CPs · 12 active · 142 kW ─┐  │
│  │ LB: ⏼ on   strategy: ▾ round_robin                          │  │
│  │                                                             │  │
│  │  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │  │
│  │  │ AC-A-001 │ AC-A-002 │ AC-A-003 │ AC-A-004 │ AC-A-005 │  │  │
│  │  │ ⚡ 14 kW │   idle   │ ⚡ 22 kW │   idle   │   idle   │  │  │
│  │  └──────────┴──────────┴──────────┴──────────┴──────────┘  │  │
│  │  …                                                          │  │
│  │  [Quick session ▾]                                          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─ Group: DC-B ──────────────── 10 CPs · 3 active · 175 kW ──┐  │
│  │ LB: ⏼ on   strategy: ▾ least_active                         │  │
│  │  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │  │
│  │  │ DC-B-001 │ DC-B-002 │ DC-B-003 │ DC-B-004 │ DC-B-005 │  │  │
│  │  │ 50 kW    │ 75 kW    │   idle   │ 50 kW    │   idle   │  │  │
│  │  │ 42% SoC  │ 67% SoC  │          │ 31% SoC  │          │  │  │
│  │  └──────────┴──────────┴──────────┴──────────┴──────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─ Active sessions ────────────────────────────────────────────┐ │
│  │ tx_id    cp_id      connector  id_tag       since   energy  │ │
│  │ 12       AC-A-001   1          USR_01       3m12s   0.78kWh │ │
│  │ 13       AC-A-003   1          USR_02       1m04s   0.32kWh │ │
│  │ …                                                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

Component breakdown:

- `FleetGroupCard` — header with rollup, LB controls, grid of `CpTile`s.
- `CpTile` — small status cell, color-coded (green idle, blue charging, red faulted), click-through to single-CP UI on `:3001` (deep link with `?cp=AC-A-001`).
- `ActiveSessionsTable` — virtualized for >100 rows.
- `NewGroupDialog` / `NewCpDialog` — simple forms, post to REST.

## File / process layout

```
backend/                            ← unchanged single-CP runtime (port :3001)
fleet/                              ← NEW
  package.json
  tsconfig.json
  src/
    index.ts                        ← Express + ws + supervisor wire-up
    sqlite.ts                       ← schema + queries (better-sqlite3)
    registry.ts                     ← in-memory CP/group state
    supervisor.ts                   ← spawn/restart workers
    worker.ts                       ← thread entry; imports backend/src/ocpp/*
    protocol.ts                     ← Down/Up message types
    load-balancer.ts                ← pickCp + strategy implementations
    api.ts                          ← REST routes
    pubsub.ts                       ← WS broadcast
    fixtures.ts                     ← bootstrap default groups for dev
  test/
    load-balancer.test.ts
    registry.test.ts
    protocol.test.ts
    sqlite.test.ts
frontend/src/pages/Fleet/           ← NEW
    FleetPage.tsx                   ← /fleet route entry
    FleetGroupCard.tsx
    CpTile.tsx
    ActiveSessionsTable.tsx
    NewGroupDialog.tsx
    NewCpDialog.tsx
    fleet-api.ts                    ← thin client for :3100
docs/SPEC_CP_FLEET_SIMULATOR.md     ← this file
```

## Failure modes

| Mode | Detection | Behavior |
|---|---|---|
| Worker thread dies | `worker.on('exit', code !== 0)` | Mark CP `faulted`; supervisor respawns with backoff (1s, 2s, 4s, max 30s) |
| Worker hangs (no `up` messages, no heartbeat) | 30s heartbeat ping/pong on the worker channel | Mark CP `faulted`; terminate worker; respawn |
| WS to gateway drops | Already handled inside `ChargePoint` (5s reconnect) | Status flips to disconnected; reconnect loop heals |
| SQLite locked (briefly) | `better-sqlite3` blocks; should be sub-ms | Acceptable; queries are short-lived |
| Fleet manager dies | systemd / dev `npm run dev:fleet` | Workers die with parent; on restart, registry is rebuilt from SQLite |
| 100 simultaneous boot | Stagger worker spawns 50 ms apart | Avoid a thundering-herd handshake on the gateway |

## Performance budget

| Metric | Target | Verified by |
|---|---|---|
| Boot time, 100 AC + 10 DC | < 30 s, last CP `Available` on the gateway | E2E test: `make fleet-100ac-10dc` |
| Steady-state RAM | < 1 GB RSS for 110 CPs | `ps -o rss` during steady state |
| Steady-state CPU | < 2 cores @ 1 Hz tick | `top -l 1 -pid` during steady state |
| Session start latency p99 | < 1 s from REST → MeterValues received by gateway | gateway log timestamps |
| Manager API p99 | < 50 ms | bench script |

## Test plan

Unit (per package):

- `load-balancer.test.ts`: round-robin advances cursor, least-active picks lowest, both filter unavailable CPs, both return null when group is empty.
- `registry.test.ts`: add CP, remove CP, group attach/detach, snapshot to SQLite + reload roundtrip equal.
- `protocol.test.ts`: every Down message round-trips through `JSON.parse(JSON.stringify(...))`.
- `sqlite.test.ts`: schema migration is idempotent.

Integration (against running gateway):

- Boot 5 AC + 2 DC, all reach `Available` within 5 s.
- Start a session via `POST /fleet/groups/:id/sessions` with LB=round-robin: assignments cycle through the available CPs in order.
- Start 5 sessions on a 5-CP group with LB=least-active: each lands on a different CP.
- `emergency_stop` from any state ends the session; CP transitions to `Faulted`.
- Kill a worker thread (test hook); supervisor respawns; CP rejoins the gateway.

Load (manual, gated behind `make fleet-load-100`):

- 100 AC CPs boot, 80% concurrently start sessions, run 5 minutes, all stop. Check: gateway saw no errors; total energy delivered matches sum-of-sessions; no worker died.

## Stacked MR plan

Five MRs after this spec lands. Each is independently reviewable.

| MR | Scope | LOC est. |
|---|---|---|
| MR-D | Fleet skeleton: supervisor, worker thread, REST `/fleet/cps`, in-memory registry. **No persistence, no LB, no UI.** Spawn N CPs by env var, watch them connect. | ~600 |
| MR-E | SQLite persistence + groups CRUD. Snapshot/restore on boot. | ~400 |
| MR-F | LoadBalancer + session-start API + WS pub/sub for UI consumers. | ~350 |
| MR-G | Fleet admin UI: `/fleet` route, group cards, CP tiles, sessions table. | ~700 |
| MR-H (optional) | Fault injection toggle, worker heartbeat, performance hardening. | ~250 |

Each MR targets the previous (`main` ← MR-D ← MR-E ← MR-F ← MR-G ← MR-H), so reviewing top-down doesn't require holding the full picture.

## Resolved questions

1. **CP id format.** Opaque `cp_<6 hex>` (e.g. `cp_a1b2c3`); friendly name lives in `display_name` on the `charge_points` row. Decouples identity from group/org structure — renaming a group never invalidates a CP id, ids stay stable across imports/exports, and the gateway already accepts arbitrary cp_ids. Friendly name is what the UI renders; the opaque id is what the gateway and logs see.

2. **Single-CP UI deep-linking.** Yes — as a small change inside MR-G, not a refactor. The existing `App.tsx` accepts `?cp=<cp_id>` from the URL: when present, it drops the local backend connection and subscribes to the fleet manager's pubsub channel for that CP id; when absent, it stays as today (connects to its own `:3001` backend). Backwards-compatible, ~50 LOC in `App.tsx` + `services/api.ts`. No per-CP backend process needed for UI viewing — the fleet manager already holds that state via worker pubsub.

   **Implementation status (post-MVP):** landed as a follow-up after MR-H. `services/api.ts` reads `?cp=` once at module load; in fleet mode `getStatus()` GETs `/fleet/cps/:cp_id` and adapts the row into the existing `Status` shape, `connectWebSocket` opens `/fleet/ws` and sends `{type:'subscribe',cp_id}`, `startCharging` / `stopCharging` route to `/fleet/cps/:cp_id/actions/*`. Pause/resume/scenarios/manual-consumption surface a friendly "not in fleet mode" message — those are out of scope for the deep-link view. The `FleetPubSub` gained per-cp_id subscriptions: `meter_tick` is unicast to subscribers only, so the fleet dashboard's clients don't see N CPs × 1 Hz tick fan-out.

3. **Dev reset.** Yes — `POST /fleet/_dev/reset` exists, gated by `EVEYS_FLEET_DEV_RESET=1`. Behavior: drops the SQLite tables, terminates all workers, re-bootstraps from `fixtures.ts`. Returns 403 if the env var isn't set to `1`. Logs loudly at WARN on invocation. Without this, every integration/load test ends up either hand-rolling teardown or `rm -f`'ing the SQLite file — both worse than a gated endpoint.

## Decisions deferred to implementation

- Exact heartbeat protocol on the worker channel (likely a `'ping'` Down with timeout — bikeshed in MR-D).
- WS broadcast coalescing window (10 ms? 100 ms?) — pick on the basis of UI feedback.
- SQLite WAL mode vs default — default is fine at v1 scale; revisit if write contention shows up.
