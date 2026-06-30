# cOCPP Charge-Point Simulator

Repo: <https://github.com/eveys-mobility/Simulator> · `git clone git@github.com:eveys-mobility/Simulator.git`

A tool that pretends to be one or many EV charging stations talking to your back-office (CSMS). You spin up devices in a web UI, start sessions, send meter readings, run reservations, push firmware updates — everything a real station does — without owning a single hardware unit.

Use it to:

- **Develop and test a back-office** without driving to a charger.
- **Reproduce field bugs** locally — bad timing, dropped connections, odd meter sequences.
- **Load-test** your back-office with hundreds of simulated stations from a single laptop.
- **Verify back-office correctness** against the OCPP 1.6 specification.

## Quick start

```sh
npm install
OCPP_URL=ws://localhost:19000 npm run dev:server &
npm run dev:web
```

- Web UI → <http://localhost:5173>
- API + WebSocket → <http://localhost:3001>

`OCPP_URL` is the address of your back-office; new devices dial it by default. You can change the address per-device in the UI.

### Makefile shortcuts

The repo ships a `Makefile` that wraps the common npm scripts. Run `make help` to see every target:

```sh
make help        # list all targets
make install     # install dependencies
make ocpp        # run the back-end (dev:server) — honors OCPP_URL
make web         # run the web UI (dev:web on :5173)
make dev         # run both together (Ctrl-C stops both)
make qa          # lint + typecheck + test
make build       # build every workspace
make update      # deploy: git pull, rebuild image, restart service (run on the server)
```

Override defaults inline, e.g. `make ocpp OCPP_URL=wss://csms.example.com/ocpp/STATION_01`.

Full guide for running locally and deploying to a server: **[`docs/RUNNING.md`](docs/RUNNING.md)**.

## What's in the box

- **Devices.** Create as many simulated charging stations as you want. Each one connects to your back-office on its own, with its own ID, password, and connector layout.
- **Sessions.** Start a session from the UI — the simulator drives the full lifecycle: authorize, plug in, charge, meter readings, stop. You see every message in real time.
- **AC and DC.** Realistic energy models for both single/three-phase AC and DC fast-charging with state-of-charge curves.
- **Reservations, firmware updates, local authorization list, smart charging profiles.** All standard OCPP 1.6 features are implemented and exercised.
- **Offline resilience.** If the back-office is unreachable, the simulator queues messages and drains them in order when it reconnects — same as a real station.

## Built-in load testing

The **Benchmarks** page in the UI runs scenarios against your back-office:

- **Smoke** — a few devices, a quick sanity run.
- **Steady** — a fixed fleet for sustained throughput.
- **Step ramp** — slowly grows the fleet to find the breaking point.
- **Custom** — fully configurable: number of devices, session rate, meter cadence, run duration.

Live counters stream while the run goes. When it finishes, the run is saved so you can revisit it later — including embedded charts (CALL rate, latency, errors, throughput, active sessions, online devices) scoped to that run's time window. Bring up the monitoring stack (`docker compose up -d`) to see the charts.

## OCPP 1.6 conformance suite

The simulator ships with a built-in test suite that runs itself against an in-process mock back-office and verifies every behaviour the OCPP 1.6 specification requires. Use it as a regression net for your own back-office: rerun the suite whenever you change something, and watch what breaks.

Profiles covered: **Core, Smart Charging, Remote Trigger, Reservation, Local Auth List Management, Firmware Management** (49 cases in total).

Run it:

```sh
npm run conformance
```

Exits non-zero on the first failure — drop it straight into a CI pipeline. The same suite is also available in the UI at **/conformance** with a *Run* button.

## Monitoring (optional)

The server exposes a metrics endpoint that Prometheus can scrape. To bring up Prometheus + Grafana with a pre-built dashboard:

```sh
docker compose up -d
```

- Prometheus → <http://localhost:9090>
- Grafana → <http://localhost:3000> (login: `admin` / `admin`)

The dashboard shows call rate, latency, errors, message throughput, and active devices/sessions.

## Tests

```sh
npm test
```

## Deployment

For production, the simulator runs as a single Docker container that serves both the web UI and the back-end on one port. SQLite holds devices, sessions, and benchmark results across restarts.

Short version:

```sh
docker build -t ocpp-sim .
docker run --rm -d -p 3001:3001 \
    -v ocpp-sim-data:/data \
    -e OCPP_URL=ws://your-csms.example.com:5080 \
    -e AUTH_TOKEN=$(openssl rand -hex 32) \
    --name ocpp-sim ocpp-sim
```

The full deployment guide — including a fresh-Ubuntu walkthrough with TLS, firewall, and auto-restart on boot — is in **[`docs/RUNNING.md`](docs/RUNNING.md)**.

## License

See [LICENSE](LICENSE) if present, otherwise contact the maintainers.
