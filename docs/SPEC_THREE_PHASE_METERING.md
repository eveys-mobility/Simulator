# Spec: Three-Phase Metering

Status: proposal — implementation MR follows acceptance.

## Why

Today the simulator computes phase derivatives but reports as if the connector were single-phase. Concretely:

- Current is computed via `power_kw / 0.69` — a 3-phase 400 V approximation — but emitted on `phase: "L1"` only. L2 and L3 are missing.
- Voltage is hard-coded `230` on `phase: "L1"`. No L2 / L3 readings, no line-to-line.
- One `Power.Active.Import` row, no per-phase split.

That's a single-phase reading dressed up with phase labels. A 22 kW Type-2 charger in the wild reports per-phase Current, per-phase Voltage, and (typically) per-phase Power. CSMS dashboards that draw "L1 / L2 / L3" panels show two empty graphs against this simulator. OCTT cases that exercise `MeterValuesSampledData` with phase-tagged measurands fail to surface a balance-vs-imbalance signal.

## What the OCPP 1.6 spec says

`SampledValue.phase` (§7.21) is an enum: `L1 | L2 | L3 | N | L1-N | L2-N | L3-N | L1-L2 | L2-L3 | L3-L1`. The same `measurand` can appear multiple times in a single `MeterValue.sampledValue[]` with different `phase` values — that's how a 3-phase reading is conveyed.

Conventions used by real chargers we want to mimic:

| Measurand | Phase tagging |
|---|---|
| `Energy.Active.Import.Register` | untagged (cumulative — single register) |
| `Power.Active.Import` | `L1`, `L2`, `L3` (three rows) — sum is total |
| `Current.Import` | `L1`, `L2`, `L3` |
| `Voltage` | `L1-N`, `L2-N`, `L3-N` (phase-to-neutral, ~230 V) |
| `SoC`, `Temperature`, `Frequency` | untagged |

`Voltage` could also be reported line-to-line (`L1-L2` etc., ~400 V). Per-phase phase-to-neutral is the more common choice on EVSE meters, so we default there and gate line-to-line behind a config knob.

## Scope

In:

- Three connector modes: `balanced` (default), `imbalanced`, `single-phase`.
- Per-phase Current, Voltage, Power emission when the corresponding measurand is configured in `MeterValuesSampledData`.
- A `PhaseModel` helper that owns the phase math so `TransactionManager` doesn't grow another 100 lines.
- UI toggle: per-connector mode selector + a small per-phase readout next to the existing power gauge.

Out:

- DC fast-charge metering (Type-2 / CCS DC has its own measurand patterns — separate spec).
- Negative power (V2G / Power.Active.Export). Trivial to add later by sign-flipping the totals; deferring to keep this MR focused.
- Real harmonics, real cos φ tracking. We assume `cos φ = 1.0` for AC simulation; `Power.Active = V × I` per phase.
- `Frequency` per phase (it's a system-level quantity).

## Phase model

```
                         ┌─────────────────┐
   total_power_kw ──────►│   PhaseModel    │
                         │                 │
   mode ────────────────►│  computeFrame() ├──►  PhaseFrame {
                         │                 │      l1: { v, i, p },
   phase_imbalance_pct ─►│                 │      l2: { v, i, p },
                         │                 │      l3: { v, i, p },
                         │                 │      total_p_kw,
                         └─────────────────┘    }
```

Mode rules:

- **`balanced`** — total power split equally across L1/L2/L3. Each phase voltage 230 V ± 0.5 V noise (so traces aren't eerily flat). `cos φ = 1`. Current per phase = `power_per_phase_w / 230`.

- **`imbalanced`** — L1 carries `(1 + skew) × P/3`, L3 carries `(1 - skew) × P/3`, L2 = `P/3`. `skew` defaults to 0.15 (so L1 ≈ 7.6 kW, L3 ≈ 5.6 kW at 22 kW total) and is exposed as `phase_imbalance_pct` config (0–30 %, hard-clamped). Models the common case of a 1-phase EV plugged into a 3-phase outlet that the EVSE happens to split poorly, or aging contactor wear.

- **`single-phase`** — all power on L1. L2/L3 report `Current = 0`, `Voltage = 230` (mains is still energised), `Power = 0`. This is the OCPP-correct shape for a Type-2 cable in mode-3 single-phase mode — the EVSE physically doesn't draw on the unused phases but still senses voltage. Setting them to `null` would be wrong and breaks CSMS dashboards that don't tolerate sparse rows.

The model is pure — no I/O, no state — so it's straightforward to unit-test:

```ts
expect(model.computeFrame(22, 'balanced')).toMatchObject({
  l1: { p: closeTo(7333, 50), i: closeTo(31.9, 0.5) },
  l2: { p: closeTo(7333, 50) },
  l3: { p: closeTo(7333, 50) },
  total_p_kw: closeTo(22, 0.05),
});
```

## Wire format change

`TransactionManager.sendMeterValues` today builds one row per measurand. The change: when a phase-aware measurand is configured, iterate over `[L1, L2, L3]` and emit three rows. Untagged measurands stay one row.

Before (today, mode = "balanced", power = 22 kW):

```json
{
  "sampledValue": [
    { "measurand": "Energy.Active.Import.Register", "value": "1820968", "unit": "Wh" },
    { "measurand": "Power.Active.Import", "value": "22000", "unit": "W" },
    { "measurand": "Current.Import", "value": "31.9", "unit": "A", "phase": "L1" },
    { "measurand": "Voltage", "value": "230", "unit": "V", "phase": "L1" }
  ]
}
```

After (mode = "balanced"):

```json
{
  "sampledValue": [
    { "measurand": "Energy.Active.Import.Register", "value": "1820968", "unit": "Wh" },
    { "measurand": "Power.Active.Import", "value": "7333", "unit": "W", "phase": "L1" },
    { "measurand": "Power.Active.Import", "value": "7333", "unit": "W", "phase": "L2" },
    { "measurand": "Power.Active.Import", "value": "7333", "unit": "W", "phase": "L3" },
    { "measurand": "Current.Import",      "value": "31.9", "unit": "A", "phase": "L1" },
    { "measurand": "Current.Import",      "value": "31.9", "unit": "A", "phase": "L2" },
    { "measurand": "Current.Import",      "value": "31.9", "unit": "A", "phase": "L3" },
    { "measurand": "Voltage",             "value": "230",  "unit": "V", "phase": "L1-N" },
    { "measurand": "Voltage",             "value": "230",  "unit": "V", "phase": "L2-N" },
    { "measurand": "Voltage",             "value": "230",  "unit": "V", "phase": "L3-N" }
  ]
}
```

After (mode = "single-phase", same 22 kW intent — note the EVSE is rate-limited to ~7.4 kW since only L1 is used):

```json
{
  "sampledValue": [
    { "measurand": "Power.Active.Import", "value": "7400", "unit": "W", "phase": "L1" },
    { "measurand": "Power.Active.Import", "value": "0",    "unit": "W", "phase": "L2" },
    { "measurand": "Power.Active.Import", "value": "0",    "unit": "W", "phase": "L3" },
    { "measurand": "Current.Import",      "value": "32.0", "unit": "A", "phase": "L1" },
    { "measurand": "Current.Import",      "value": "0",    "unit": "A", "phase": "L2" },
    { "measurand": "Current.Import",      "value": "0",    "unit": "A", "phase": "L3" },
    { "measurand": "Voltage",             "value": "230",  "unit": "V", "phase": "L1-N" },
    { "measurand": "Voltage",             "value": "230",  "unit": "V", "phase": "L2-N" },
    { "measurand": "Voltage",             "value": "230",  "unit": "V", "phase": "L3-N" }
  ]
}
```

Single-phase mode also caps `total_p_kw` at `230 V × maxCurrent / 1000` regardless of the requested ramp-up target — this is the physical limit that actual single-phase Type-2 charging hits.

## Config keys

OCPP keys (visible to the CSMS via `GetConfiguration`):

| Key | Default | Notes |
|---|---|---|
| `MeterValuesSampledData` | adds `Power.Active.Import` to the existing list — already supports phase-tagged measurands; this MR fixes the emitter side. | |

Simulator-internal keys (UI + per-connector config file, not OCPP-visible):

| Key | Default | Range |
|---|---|---|
| `phase_mode` | `balanced` | `balanced \| imbalanced \| single-phase` |
| `phase_imbalance_pct` | `15` | `0`–`30` |
| `voltage_reporting` | `phase-to-neutral` | `phase-to-neutral \| line-to-line` |
| `nominal_voltage_v` | `230` | informational; the model uses this as the per-phase base |

Mode is per-connector, set via `POST /api/connectors/:id/phase-mode` (new endpoint) and surfaced in `GET /api/status`.

## UI

A small phase-mode selector on each connector's `ChargingControls` card:

```
┌──────────────────────────────────────────┐
│  Connector 1                             │
│  ┌────────────────────────────────────┐  │
│  │  Phase mode:  ( ) balanced         │  │
│  │               (•) imbalanced 15%   │  │
│  │               ( ) single-phase     │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌──────┬──────┬──────┐                  │
│  │  L1  │  L2  │  L3  │  ← per-phase    │
│  │ 7.6  │ 7.3  │ 6.4  │     readout     │
│  │ kW   │ kW   │ kW   │                 │
│  └──────┴──────┴──────┘                  │
│                                          │
│  [Start] [Stop]                          │
└──────────────────────────────────────────┘
```

Live values come from the same `sessionUpdated` events the gauge already consumes — extend the `ChargingSession` type with `phaseFrame: PhaseFrame | null`.

## Tracing

`PhaseModel.computeFrame` is silent (called every meter-value tick — logging would be noise). Mode changes log at `info` level:

```
{"event":"phase_mode.changed","component":"TransactionManager","connector_id":1,"from":"balanced","to":"imbalanced","imbalance_pct":15}
```

Validation failures (mode set to invalid value, imbalance > 30 %) log at `warn` and clamp.

## Files touched

```
backend/src/ocpp/PhaseModel.ts            # NEW — pure helper, ~80 LOC
backend/src/ocpp/PhaseModel.test.ts       # NEW — unit tests, ~120 LOC
backend/src/ocpp/TransactionManager.ts    # extend sendMeterValues to iterate phases
backend/src/api/routes.ts                 # POST /api/connectors/:id/phase-mode
backend/src/models/ChargingSession.ts     # add phaseFrame field
backend/src/ocpp/ConfigurationManager.ts  # phase_mode, phase_imbalance_pct, voltage_reporting
frontend/src/components/ChargingControls.tsx  # mode selector
frontend/src/components/Dashboard.tsx     # per-phase readout
frontend/src/services/api.ts              # setPhaseMode endpoint
docs/SPEC_THREE_PHASE_METERING.md         # this file (delete on merge of follow-up MR? optional)
```

Estimated diff: ~400 LOC. Single MR off `main`.

## Test plan

Unit (PhaseModel):

- balanced @ 22 kW → three equal phases summing to 22 kW within 50 W; current ≈ 31.9 A
- imbalanced @ 22 kW, 15 % skew → L1 ≈ 7.6 kW, L2 ≈ 7.3 kW, L3 ≈ 6.4 kW; sum = 22 kW exactly
- single-phase @ 32 A cap → L1 ≈ 7.4 kW, L2 = L3 = 0; voltage on all three still 230 V
- imbalance ≥ 30 % clamps to 30 %
- mode = `bogus` falls back to `balanced` and emits a `warn` log

Integration (against running gateway):

- start a session, switch mode mid-session, verify a `MeterValues` payload contains 3-phase rows after the switch and the connector readout in the UI updates within 5 s
- OCTT-style: confirm CSMS-side parsing accepts the multi-row sampledValue array (gateway logs no schema warnings)
- single-phase mode caps power at ~7.4 kW even when the user drags the manual-consumption slider higher

## Risks

- **Storage size**: each `MeterValues` payload triples in size for phase-aware measurands. Negligible at 22 kW / 60 s intervals (KB scale), but worth flagging if the user later tunes `MeterValueSampleInterval` very low.
- **Backward compat**: any CSMS code that grabs the *first* `Current.Import` row instead of summing/picking-by-phase may misread "L1 of 3-phase" as "the only measurement". Real chargers already emit per-phase rows, so any well-behaved CSMS handles this; gateway-side unit tests already iterate, no expected regression on the eveys gateway.
- **Persistence**: `meter_storage` already accumulates total energy; no schema change needed. Per-phase energy registers (`Energy.Active.Import.Register` per `phase`) are out of scope — the cumulative register stays untagged.

## Open questions for review

1. Should `voltage_reporting=line-to-line` be in the first MR or deferred? Keeping it in costs ~10 LOC; deferring lets us merge faster.
2. Default mode for new connectors: `balanced` (proposed) vs read from `NUMBER_OF_PHASES` env (1 → single-phase, 3 → balanced). The env approach mirrors how real EVSEs are commissioned.
3. Phase rotation / sequence indicator (`L1 → L2 → L3` vs reverse): typically out-of-band, but OCTT may probe it. Skip until a test fails?
