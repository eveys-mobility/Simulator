# Spec: DC fast-charging support

Status: implemented in this MR.

## Why

Real DC chargers (CCS, CHAdeMO) and AC chargers report fundamentally different shapes over OCPP 1.6 MeterValues:

| Thing | AC | DC |
|---|---|---|
| Power range | 3.7–22 kW | 50–350+ kW |
| Voltage | 230 V phase-to-N (3 phases) | 200–920 V DC bus, **rises with SoC** |
| Current | 16–32 A per phase | 100–500 A on a single conductor |
| Phase tagging | yes (L1/L2/L3) | no — single readings |
| Charging curve | ~flat | ramp-up → flat → BMS taper after ~60% SoC |
| `SoC` | not meaningful (no BMS link) | always reported (EV → EVSE via CCS) |
| Connector | Type 2 socket | CCS Combo 2 / CHAdeMO |

Previously the simulator only modelled AC. Hooking a CSMS up to it for DC tests gave the wrong shape: per-phase rows where there shouldn't be any, voltage stuck at 230 V, no SoC, flat power instead of a taper.

## Scope

In:

- `connector_type ∈ {AC, DC}` per connector. Default `AC`. Persisted via `ConfigurationManager` (`connector_type_C{n}` key).
- `DCModel` pure helper: given a battery profile (capacity kWh, charger max kW, initial SoC, target SoC, ramp-up seconds) and the elapsed time, computes the next frame (SoC%, V, A, W, delivered Wh, completed flag).
- DC charging-simulation loop in `TransactionManager`: per-second tick that runs the model, accumulates SoC, auto-stops the transaction at the target SoC.
- DC `MeterValues` shape: single (no `phase`) Power/Current/Voltage rows, mandatory SoC, optional Temperature; all tagged `location` (`Outlet` for the bus measurements, `EV` for SoC, `Body` for temperature).
- REST: `GET/POST /api/connectors/:id/type` and `GET/POST /api/connectors/:id/dc-profile`.
- UI: connector tile shows an `AC` / `DC` pill; when DC, the `PhaseReadout` is replaced by `DCReadout` (SoC bar with target marker + Bus V / Current / Power cells); the AC `PhaseModeSelector` is hidden.

Out:

- CCS handshake / cable insulation test simulation. The `ramp_up_seconds` window approximates this latency but doesn't generate the protocol-level events.
- 2-conductor splits (CCS DC+ / DC-) — we report a single bus reading.
- Per-phase tagging on DC (some niche EVSEs do report `phase=DC`; OCPP 1.6 §7.21 doesn't list `DC` as a valid phase value, so we omit `phase` entirely, which is the conformant choice).
- V2G (negative power export). Add later by signing the power figure.
- Live charger temperature from a thermal model. We jitter 25–45 °C.
- CHAdeMO-specific quirks (it's basically the same shape over OCPP).

## Charging curve

```
power
 ▲
 │ ────────────────────────────╮
 │                              ╲
 │                               ╲___
 │                                   ╲___
 │                                       ╲___
 │  /                                        ╲_____
 │ /                                              ╲___ ╲_
 └──┬──────────────────────────┬───┬───┬───┬───┬───┬───────► SoC
   ramp                       60% 70% 80% 90% 95% 100%
   (cable handshake)

  CC phase (flat)            CV phase (taper)
```

Power-vs-SoC fractions:

| SoC range | Power as % of charger max |
|---|---|
| 0–60% | 100% |
| 60–70% | 70% |
| 70–80% | 50% |
| 80–90% | 30% |
| 90–95% | 15% |
| 95–100% | 5% |

The piecewise curve is intentionally chunky: real BMS firmware steps down at characteristic SoC thresholds rather than smoothly tapering, so this looks more authentic on a CSMS plot than a smoothed exponential would.

Voltage tracks SoC linearly: `nominal × (0.90 + 0.15 × soc/100)`. So a 400 V pack reads ~360 V at 0%, ~400 V at ~67%, ~415 V at 100%.

## Wire format

DC `MeterValues.sampledValue[]`:

```json
[
  { "measurand": "Energy.Active.Import.Register",
    "value": "1821828", "unit": "Wh" },
  { "measurand": "Power.Active.Import",
    "value": "50000", "unit": "W", "location": "Outlet" },
  { "measurand": "Current.Import",
    "value": "133.7", "unit": "A", "location": "Outlet" },
  { "measurand": "Voltage",
    "value": "374", "unit": "V", "location": "Outlet" },
  { "measurand": "SoC",
    "value": "23", "unit": "Percent", "location": "EV" }
]
```

No `phase` attribute on any row. SoC is always present regardless of `MeterValuesSampledData` configuration — for DC connectors it's the headline measurement.

## Defaults

| Field | Default | Notes |
|---|---|---|
| `capacity_kwh` | 60 | typical mid-size EV pack |
| `charger_max_kw` | 100 | mid-tier DC charger |
| `nominal_voltage_v` | 400 | 800V is for E-GMP / Lucid |
| `initial_soc_pct` | 20 | starts most sessions in CC phase |
| `target_soc_pct` | 80 | the "fast-charge sweet spot"; set 100 for full-charge sim |
| `ramp_up_seconds` | 25 | cable handshake + insulation test |

All tunable per connector via `POST /api/connectors/:id/dc-profile`.

## Test plan

Unit (DCModel — 16 tests, all passing):

- Ramp-up: 0 W at t=0, half power at t=ramp/2, full at t=ramp.
- Taper bands: 100% at SoC=30%, 70% at 60%, 50% at 70%, 15% at 90%.
- Voltage curve: 360 V at 0% SoC, 420 V at 100%, 780 V at 50% SoC on an 800 V pack.
- SoC advancement: 100 kW × 10 s at 60 kWh capacity → +0.46% SoC.
- Energy accumulation matches the SoC tick.
- Completion: hits target → emits `completed=true`, freezes power at 0 W.
- Edge cases: zero capacity does not divide by zero, SoC clamps to 100.

Integration (verified against running gateway):

- Set connector 1 to DC, profile `{capacity:5kWh, max:50kW, soc:20→80, ramp:3s}`.
- RemoteStart → StartTransaction Accepted → MeterValues every 5 s with the 5-row DC shape.
- Voltage rises from 372 → 375 V across SoC 21% → 25%.
- Power held at the rated 50 kW (CC phase).
- Auto-stop fires when SoC crosses target; StopTransaction emitted with `reason=EVDisconnected`.

## Files

```
backend/src/ocpp/DCModel.ts            # NEW — pure helper
backend/src/ocpp/DCModel.test.ts       # NEW — 16 unit tests
backend/src/ocpp/TransactionManager.ts # connector-type branch + DC sim loop + DC MeterValues shape
backend/src/api/routes.ts              # /connectors/:id/type + /dc-profile
backend/src/models/ChargingSession.ts  # dcFrame, socPercent on the session
frontend/src/components/DCReadout.tsx  # NEW — SoC bar + V/A/kW cells
frontend/src/components/Dashboard.tsx  # AC/DC pill, swaps PhaseReadout ↔ DCReadout
frontend/src/components/ChargingControls.tsx  # hides PhaseModeSelector for DC
frontend/src/services/api.ts           # ConnectorType, DCFrame, DCBatteryProfile types + setters
docs/SPEC_DC_METERING.md               # this file
```
