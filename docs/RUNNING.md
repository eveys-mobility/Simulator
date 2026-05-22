# Running the simulator

Two ways to run: **local dev** (hot-reload, split server + Vite) and **production** (single container, one port, persisted SQLite).

---

## Local development

Two processes: a Fastify+ws server on `:3001` and a Vite SPA on `:5173`. Vite proxies API + WebSocket calls to the server, so the SPA hits a single origin from the browser's perspective.

### Prerequisites

- Node.js ≥ 20 (`node -v`)
- Toolchain for `better-sqlite3` native build (macOS: Xcode CLT; Linux: `python3 make g++`)

### Install + run

```sh
npm install

# terminal 1 — Fastify server (REST + WS + OCPP client)
OCPP_URL=ws://localhost:19000 npm run dev:server

# terminal 2 — Vite SPA (hot reload)
npm run dev:web
```

Open <http://localhost:5173>.

- Server API: <http://localhost:3001/api/*>
- Server WS pub/sub: `ws://localhost:3001/api/ws`
- SPA dev server: <http://localhost:5173>
- Default OCPP gateway target: `ws://localhost:19000` (override via `OCPP_URL` or per-device in the Settings page)

The server defaults to `HOST=127.0.0.1` in dev so a fresh checkout doesn't expose itself on the LAN. Set `HOST=0.0.0.0` if you need another device on your network to hit it.

### SQLite location

Dev writes to `./data/sim.sqlite` (created on first run). Delete the file to reset all devices, sessions, and benchmark runs.

### Observability (optional)

Prometheus + Grafana run in Compose; the simulator stays on the host:

```sh
docker compose up -d
# Prometheus → http://localhost:9090
# Grafana    → http://localhost:3000  (admin / admin)
```

Grafana scrapes `host.docker.internal:3001/metrics`. The pre-provisioned *OCPP Simulator — Overview* dashboard covers CALL rate, p99 latency, errors, frame throughput, and active devices/sessions.

### Running against a real CSMS

Point `OCPP_URL` at the CSMS:

```sh
OCPP_URL=wss://csms.example.com/ocpp/CP_001 npm run dev:server
```

For self-signed dev CSMSes, add `TLS_INSECURE=1` (never in production). For OCPP 1.6 §17.4 basic auth, set the device's `authPassword` in the **Edit device** dialog — the simulator presents `Authorization: Basic base64(deviceId:password)` on the upgrade.

### Tests + conformance

```sh
npm test                  # all workspace tests
npm run conformance       # OCPP 1.6 conformance suite (Core/SmartCharging/etc.)
npm run lint              # biome
```

---

## Production

One Docker image runs the server **and** serves the built SPA on a single port. No separate Vite process; no reverse proxy needed for splitting front + back.

### Fresh Ubuntu server — start to finish

Tested on Ubuntu 22.04 / 24.04 LTS. Assumes a non-root user with sudo and an A record pointing at the box (e.g. `sim.example.com`). Run every step over SSH.

#### 1. Update + base utilities

```sh
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl gnupg ufw git
```

#### 2. Install Docker Engine (official repo)

```sh
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
newgrp docker     # or log out + back in
docker run --rm hello-world
```

#### 3. Firewall

Open SSH + the reverse proxy ports only. The simulator stays bound to the Docker bridge / localhost; never expose `:3001` directly.

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

#### 4. Clone + build the image

```sh
sudo mkdir -p /opt/ocpp-sim && sudo chown $USER:$USER /opt/ocpp-sim
cd /opt/ocpp-sim
git clone https://github.com/<your-org>/ocpp-chargepoint-simulator.git .
docker build -t ocpp-sim .
```

#### 5. Generate the auth token + persist it

```sh
sudo mkdir -p /etc/ocpp-sim
openssl rand -hex 32 | sudo tee /etc/ocpp-sim/auth-token >/dev/null
sudo chmod 600 /etc/ocpp-sim/auth-token
cat /etc/ocpp-sim/auth-token   # save this — the SPA will ask for it on first load
```

#### 6. Run the container as a systemd unit

A systemd unit (instead of `docker run --restart`) gives you predictable logs via `journalctl` and `systemctl status` for ops.

```sh
sudo tee /etc/systemd/system/ocpp-sim.service >/dev/null <<'EOF'
[Unit]
Description=OCPP charge-point simulator
Requires=docker.service
After=docker.service network-online.target

[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f ocpp-sim
ExecStart=/bin/sh -c '/usr/bin/docker run --rm --name ocpp-sim \
    -p 127.0.0.1:3001:3001 \
    -v ocpp-sim-data:/data \
    -e OCPP_URL=wss://csms.example.com/ocpp/CP_001 \
    -e AUTH_TOKEN=$(cat /etc/ocpp-sim/auth-token) \
    ocpp-sim'
ExecStop=/usr/bin/docker stop ocpp-sim

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ocpp-sim
sudo systemctl status ocpp-sim
journalctl -u ocpp-sim -f         # tail logs
```

Edit `OCPP_URL` in the unit file to your real CSMS before enabling. The port is published to `127.0.0.1` only — the reverse proxy below exposes it publicly with TLS.

#### 7. TLS + public hostname via Caddy

Caddy is the shortest path on Ubuntu: one binary, one config line per host, auto-renewing Let's Encrypt certs.

```sh
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy

sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
sim.example.com {
    reverse_proxy 127.0.0.1:3001
}
EOF

sudo systemctl reload caddy
```

Caddy obtains the cert on first request and proxies both HTTP and the `/api/ws` upgrade automatically. Hit `https://sim.example.com`, paste the token, you're in.

If you prefer nginx, the equivalent config is in the [Reverse proxy](#tls--public-hostname) section below — install with `sudo apt -y install nginx`, drop the config in `/etc/nginx/sites-available/ocpp-sim`, then `sudo certbot --nginx -d sim.example.com` to provision the cert.

#### 8. Verify

```sh
# from the server
curl -s http://127.0.0.1:3001/api/health
curl -s -H "Authorization: Bearer $(sudo cat /etc/ocpp-sim/auth-token)" \
  http://127.0.0.1:3001/metrics | head

# from your laptop
curl -s https://sim.example.com/api/health
```

#### 9. Upgrades

```sh
cd /opt/ocpp-sim
git pull
docker build -t ocpp-sim .
sudo systemctl restart ocpp-sim
```

The named `ocpp-sim-data` volume keeps the SQLite database across rebuilds.

#### 10. Observability (optional)

If you want Prometheus + Grafana on the same box, `cd /opt/ocpp-sim && docker compose up -d`. Before that, edit `observability/prometheus.yml` to scrape `host.docker.internal:3001` with a `bearer_token` line carrying your `AUTH_TOKEN`, and add `extra_hosts: ['host.docker.internal:host-gateway']` to the simulator's scrape target if Prometheus runs in a separate Compose project. Keep Grafana behind the same Caddy / firewall — don't expose `:3000` publicly.

---

### Build the image

```sh
docker build -t ocpp-sim .
```

The multi-stage `Dockerfile` builds the web bundle, rebuilds the `better-sqlite3` native binding, and ships a slim runtime stage that runs `npm --workspace @ocpp-sim/server run start` under `tini`.

### Run

```sh
docker run --rm -d \
    -p 3001:3001 \
    -v ocpp-sim-data:/data \
    -e OCPP_URL=wss://csms.example.com/ocpp/CP_001 \
    -e AUTH_TOKEN=$(openssl rand -hex 32) \
    --name ocpp-sim \
    ocpp-sim
```

UI + API at <http://localhost:3001>. SQLite persists to the named volume `ocpp-sim-data` (mounted at `/data` inside the container) so devices, sessions, and benchmark runs survive restarts.

Print the auth token you generated; the SPA will prompt for it on first load.

### Required production settings

| Setting | Why |
|---|---|
| `AUTH_TOKEN` | Without it, the API + WS + `/metrics` are unauthenticated. `/api/health` and `/api/auth/ping` stay open for probes / SPA bootstrap. |
| Persistent volume on `/data` | SQLite holds devices, sessions, benchmark runs. Loss = full reset. |
| `OCPP_URL` pointing at your CSMS | Otherwise new devices default to `ws://localhost:19000`, which won't resolve from inside the container. |

### All environment variables

| Var | Default (image) | Default (dev) | Notes |
|---|---|---|---|
| `PORT` | `3001` | `3001` | HTTP/WS listen port. |
| `HOST` | `0.0.0.0` | `127.0.0.1` | Bind address. Dev = loopback, image = all interfaces. |
| `OCPP_URL` | `ws://localhost:19000` | same | Default gateway for new devices. The Settings page persists overrides. |
| `DB_PATH` | `/data/sim.sqlite` | `./data/sim.sqlite` | SQLite file. Mount a volume in production. |
| `AUTH_TOKEN` | unset | unset | Bearer token gating `/api/*` and `/metrics`. Required in production. |
| `WEB_DIST_DIR` | `/app/packages/web/dist` | unset | Set automatically inside the image. Leave unset in dev — Vite serves on `:5173`. |
| `TLS_INSECURE` | unset | unset | `1` to skip `wss://` certificate verification. Dev-only. |
| `OFFLINE_QUEUE_MAX` | `10000` | `10000` | Per-device offline OCPP queue cap. Messages beyond this are dropped oldest-first. |

### Health + metrics

- `GET /api/health` — open, no auth. Use as Docker `HEALTHCHECK` or k8s liveness/readiness.
- `GET /metrics` — Prometheus text format. Requires `Authorization: Bearer $AUTH_TOKEN` when `AUTH_TOKEN` is set.

Example healthcheck in `docker run`:

```sh
docker run --rm -d \
    -p 3001:3001 \
    -v ocpp-sim-data:/data \
    -e AUTH_TOKEN=… \
    -e OCPP_URL=wss://csms.example.com/ocpp/CP_001 \
    --health-cmd='wget -qO- http://127.0.0.1:3001/api/health || exit 1' \
    --health-interval=15s --health-timeout=3s --health-retries=3 \
    --name ocpp-sim ocpp-sim
```

### docker-compose

The bundled `docker-compose.yml` only carries the observability stack (Prometheus + Grafana scraping the host). To run the simulator under Compose too, add a service alongside them:

```yaml
services:
    simulator:
        image: ocpp-sim
        build: .
        ports:
            - '3001:3001'
        environment:
            OCPP_URL: wss://csms.example.com/ocpp/CP_001
            AUTH_TOKEN: ${OCPP_SIM_AUTH_TOKEN}
        volumes:
            - ocpp-sim-data:/data
        restart: unless-stopped

volumes:
    ocpp-sim-data:
```

Then `OCPP_SIM_AUTH_TOKEN=$(openssl rand -hex 32) docker compose up -d`.

If Prometheus also runs in Compose, change its scrape target from `host.docker.internal:3001` to `simulator:3001` and forward `AUTH_TOKEN` as a `bearer_token` in `observability/prometheus.yml`.

### TLS + public hostname

The server speaks plain HTTP + WS. Terminate TLS at a reverse proxy and forward both `/` (HTTP) and `/api/ws` (WebSocket upgrade) to the container.

#### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name sim.example.com;

    ssl_certificate     /etc/letsencrypt/live/sim.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sim.example.com/privkey.pem;

    location /api/ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Caddy

```caddyfile
sim.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Caddy handles the WebSocket upgrade for `/api/ws` automatically.

### Auth at a glance

- `AUTH_TOKEN` is one shared secret. It gates REST, WS, and `/metrics`.
- The SPA prompts for the token when the backend reports `authRequired`, stores it in `localStorage`, and attaches it to REST + WS requests.
- Browser WebSocket can't set headers, so the client passes the token via `?token=…` or a `bearer.<token>` subprotocol. The reverse-proxy config above forwards both.

### Logs + graceful shutdown

`tini` is PID 1 inside the image so `docker stop` (SIGTERM) reaches the Node process, which closes OCPP sockets cleanly and flushes SQLite. Default log destination is stdout/stderr — collect via your container runtime's standard log driver.

### Upgrading

The SQLite schema is created/migrated on boot. To upgrade:

```sh
docker pull ocpp-sim:<new-tag>   # or rebuild locally
docker stop ocpp-sim && docker rm ocpp-sim
docker run … ocpp-sim:<new-tag>  # same volume, same env
```

The named volume keeps the database; the new image picks up where the old one left off.
