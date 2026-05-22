# Running the simulator

Two scenarios are covered:

- **On your laptop** for development and exploration — fast feedback, hot reload, no Docker required.
- **On a server** for everyone on your team to share — one container, runs forever, behind a public hostname with HTTPS.

A quick word on terminology: throughout this guide, **back-office** means the OCPP server that real charging stations would talk to. You may also see it called the *CSMS* (Charging Station Management System) — same thing. The simulator's job is to pretend to be charging stations and talk to that back-office on their behalf.

---

## On your laptop

The simulator has two parts that run side by side:

- A **back-end** that holds your simulated devices, talks OCPP to your back-office, and exposes a small API.
- A **web UI** where you create devices, start sessions, watch messages flow, and run benchmarks.

In development you run them as two processes so the UI hot-reloads on every change. In production they're bundled together — one container, one port — and you don't think about them separately.

### What you need

- Node.js 20 or newer (`node -v` to check).
- A C++ toolchain for the database driver:
    - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
    - **Linux**: `python3`, `make`, `g++`.

### Install and run

```sh
npm install

# In one terminal — the back-end
OCPP_URL=ws://localhost:19000 npm run dev:server

# In another terminal — the web UI
npm run dev:web
```

Open <http://localhost:5173> in your browser. That's the simulator UI.

A few things to know:

- `OCPP_URL` is the address of your back-office. The example points at `localhost:19000` because that's a common default for local back-office setups; change it to wherever yours runs. The address you set here is just the **default** for newly created devices — once a device exists, you can edit its address from the UI.
- The back-end serves the API at `http://localhost:3001` and a real-time updates channel at `ws://localhost:3001/api/ws`. The UI talks to both for you.
- By default the back-end only listens on `127.0.0.1` so a fresh checkout doesn't expose itself to your office Wi-Fi. If a teammate on your network needs to hit it, set `HOST=0.0.0.0`.

### Where data lives

Your devices, sessions, and benchmark results are saved to `./data/sim.sqlite` in the project folder. Delete that file to wipe everything and start fresh.

### Pointing at a real back-office

Just change `OCPP_URL`:

```sh
OCPP_URL=wss://your-csms.example.com/ocpp/STATION_01 npm run dev:server
```

If your back-office uses HTTPS (`wss://`) with a certificate signed by a real authority, that's all — it just works. If it uses a self-signed certificate (common in test environments), add `TLS_INSECURE=1` to skip certificate verification. Never do that in production.

If your back-office requires a password (it'll ask for one over HTTP basic auth on the WebSocket handshake), set the password on each device from the **Edit device** dialog. Leave it blank for back-offices that accept any connection.

### Tests and the built-in conformance suite

```sh
npm test            # run all tests
npm run conformance # run the OCPP 1.6 conformance suite
npm run lint        # lint the code
```

The conformance suite is also exposed in the UI at `/conformance` with a *Run* button.

### Optional: charts and metrics

The simulator publishes operational metrics that Prometheus can read. To bring up Prometheus and Grafana with a ready-made dashboard:

```sh
docker compose up -d
```

- Prometheus → <http://localhost:9090>
- Grafana → <http://localhost:3000> (login: `admin` / `admin`)

The simulator itself stays on your laptop (not in Docker) — only Prometheus and Grafana run in containers, and they reach the simulator across the host network. The dashboard is called *OCPP Simulator — Overview* and shows call rate, latency, errors, throughput, and active devices and sessions.

---

## On a server

Production mode is a single Docker container that serves the API and the web UI together on one port. Your data lives on a Docker volume so it survives restarts and upgrades.

You'll almost certainly want to put it behind a reverse proxy that handles HTTPS — the simulator itself only speaks plain HTTP. The walkthrough below sets up everything from scratch on a fresh Ubuntu box.

### Fresh Ubuntu walkthrough

Tested on Ubuntu 22.04 and 24.04 LTS. You'll need:

- A server you can SSH into as a regular user with `sudo`.
- A domain name pointing at the server (for example, `sim.example.com`).

#### Step 1 — Update the system and install basics

```sh
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl gnupg ufw git
```

#### Step 2 — Install Docker

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
newgrp docker     # or log out and log back in
docker run --rm hello-world
```

If `hello-world` prints a welcome message, Docker is working.

#### Step 3 — Open the firewall for the web only

You want the world to reach your reverse proxy (ports 80 and 443) and you to reach SSH. The simulator's own port stays internal.

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

#### Step 4 — Get the code and build the image

```sh
sudo mkdir -p /opt/ocpp-sim && sudo chown $USER:$USER /opt/ocpp-sim
cd /opt/ocpp-sim
git clone https://github.com/eveys-mobility/Simulator.git .
docker build -t ocpp-sim .
```

The build takes a few minutes the first time.

#### Step 5 — Create an access token

The simulator is protected by a single shared password (called the auth token). Generate one and save it to a file so you can reuse it across restarts:

```sh
sudo mkdir -p /etc/ocpp-sim
openssl rand -hex 32 | sudo tee /etc/ocpp-sim/auth-token >/dev/null
sudo chmod 600 /etc/ocpp-sim/auth-token
cat /etc/ocpp-sim/auth-token   # save this — the UI will ask for it
```

Save the token somewhere safe — your password manager is a good spot. The web UI will ask for it the first time you visit.

#### Step 6 — Start the container under systemd

Putting the container under systemd means Ubuntu starts it on boot, restarts it if it crashes, and gives you proper logs via `journalctl`.

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
    -e OCPP_URL=wss://your-csms.example.com/ocpp/STATION_01 \
    -e AUTH_TOKEN=$(cat /etc/ocpp-sim/auth-token) \
    ocpp-sim'
ExecStop=/usr/bin/docker stop ocpp-sim

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ocpp-sim
sudo systemctl status ocpp-sim
journalctl -u ocpp-sim -f         # press Ctrl+C to stop following logs
```

Before running the commands above, change `OCPP_URL` to your real back-office address. Notice the port mapping: `127.0.0.1:3001:3001` keeps the simulator reachable only from the server itself. The reverse proxy you set up next is what exposes it to the outside world, over HTTPS.

#### Step 7 — HTTPS and a public address

Caddy is the simplest option: one config line per site, certificates from Let's Encrypt managed automatically.

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

Replace `sim.example.com` with your domain. Caddy will fetch a real HTTPS certificate the first time someone visits your URL. Open `https://sim.example.com`, paste your token, and you're in.

Prefer nginx instead? Install it (`sudo apt -y install nginx`), use the nginx config in the [reverse proxy reference](#reverse-proxy-reference) further down, and get a certificate with `sudo certbot --nginx -d sim.example.com`.

#### Step 8 — Make sure it works

```sh
# On the server itself
curl -s http://127.0.0.1:3001/api/health
curl -s -H "Authorization: Bearer $(sudo cat /etc/ocpp-sim/auth-token)" \
  http://127.0.0.1:3001/metrics | head

# From your laptop
curl -s https://sim.example.com/api/health
```

The health endpoint should return a small JSON blob with `"ok": true`.

#### Step 9 — Updating to a new version later

```sh
cd /opt/ocpp-sim
git pull
docker build -t ocpp-sim .
sudo systemctl restart ocpp-sim
```

Your devices, sessions, and benchmark results stay where they are — the data volume is separate from the image.

#### Step 10 — Charts on the same server (optional)

If you want Prometheus and Grafana on the same box:

```sh
cd /opt/ocpp-sim
docker compose up -d
```

A couple of caveats:

- Edit `observability/prometheus.yml` and add your auth token as a bearer credential so Prometheus can read the metrics endpoint.
- Don't expose Grafana's port to the world. Either keep it behind the firewall and SSH-tunnel to it, or add another Caddy block protecting it.

---

## Reference

This part is for when you already know what you're doing and just need a value or a config snippet.

### Quick deploy (without the Ubuntu walkthrough)

If you already have Docker, you can skip most of the steps above:

```sh
docker build -t ocpp-sim .
docker run --rm -d \
    -p 3001:3001 \
    -v ocpp-sim-data:/data \
    -e OCPP_URL=wss://your-csms.example.com/ocpp/STATION_01 \
    -e AUTH_TOKEN=$(openssl rand -hex 32) \
    --name ocpp-sim \
    ocpp-sim
```

The UI is at <http://localhost:3001>. The data volume is named `ocpp-sim-data` and lives at `/data` inside the container.

Print the auth token you generated above (it's in the `docker inspect` output) — the UI asks for it on first load.

### What you must set for production

| Setting | Why it matters |
|---|---|
| `AUTH_TOKEN` | Without it, anyone who can reach the server can use the simulator and read its metrics. |
| A persistent volume on `/data` | Without it, your devices and history vanish whenever the container restarts. |
| `OCPP_URL` set to your real back-office | Otherwise new devices try to dial the example address and never connect. |

### All settings

| Variable | Default in the image | Default in dev | What it does |
|---|---|---|---|
| `PORT` | `3001` | `3001` | The port the simulator listens on. |
| `HOST` | `0.0.0.0` | `127.0.0.1` | Which network address to bind to. The image binds everywhere; dev binds to localhost only so a fresh checkout isn't exposed to the network. |
| `OCPP_URL` | `ws://localhost:19000` | same | The back-office address that newly created devices use by default. |
| `DB_PATH` | `/data/sim.sqlite` | `./data/sim.sqlite` | Where the database file lives. Always put it on a mounted volume in production. |
| `AUTH_TOKEN` | unset | unset | The shared access password. **Required in production.** |
| `WEB_DIST_DIR` | `/app/packages/web/dist` | unset | Where the bundled UI lives. The image sets this for you. Leave it unset in dev. |
| `TLS_INSECURE` | unset | unset | Set to `1` to skip HTTPS certificate verification when connecting to back-offices with self-signed certificates. **Never use in production.** |
| `OFFLINE_QUEUE_MAX` | `10000` | `10000` | How many messages each device may queue when its back-office is unreachable. When the queue is full, the oldest message is dropped. |

### Health and metrics endpoints

- **`GET /api/health`** — no authentication required. Returns a small JSON object so health checkers can verify the service is up.
- **`GET /metrics`** — Prometheus-format metrics. When `AUTH_TOKEN` is set, you must send it as `Authorization: Bearer <token>`.

Example using Docker's built-in health check:

```sh
docker run --rm -d \
    -p 3001:3001 \
    -v ocpp-sim-data:/data \
    -e AUTH_TOKEN=… \
    -e OCPP_URL=wss://your-csms.example.com/ocpp/STATION_01 \
    --health-cmd='wget -qO- http://127.0.0.1:3001/api/health || exit 1' \
    --health-interval=15s --health-timeout=3s --health-retries=3 \
    --name ocpp-sim ocpp-sim
```

### Docker Compose

The repo ships a `docker-compose.yml` that brings up Prometheus and Grafana — but not the simulator itself, because in development the simulator runs from `npm run dev:server` on your laptop. To run everything together under Compose, add a service for the simulator alongside the existing ones:

```yaml
services:
    simulator:
        image: ocpp-sim
        build: .
        ports:
            - '3001:3001'
        environment:
            OCPP_URL: wss://your-csms.example.com/ocpp/STATION_01
            AUTH_TOKEN: ${OCPP_SIM_AUTH_TOKEN}
        volumes:
            - ocpp-sim-data:/data
        restart: unless-stopped

volumes:
    ocpp-sim-data:
```

Then:

```sh
OCPP_SIM_AUTH_TOKEN=$(openssl rand -hex 32) docker compose up -d
```

If Prometheus is also in this Compose project, change its scrape target from `host.docker.internal:3001` to `simulator:3001` and pass the auth token in `observability/prometheus.yml`.

### Reverse proxy reference

The simulator speaks plain HTTP. Any modern reverse proxy can sit in front of it and add HTTPS, a public hostname, and (optionally) rate limiting or extra access control.

**Caddy** (recommended for simplicity):

```caddyfile
sim.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

**nginx**:

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

The nginx `/api/ws` block is important: real-time updates to the UI flow over a WebSocket, which needs the `Upgrade` header. Caddy handles this automatically.

### How access control works

There is one shared password, called the auth token (`AUTH_TOKEN`). It protects everything: the API, the real-time updates channel, and the metrics endpoint. The only exceptions are the health endpoint (so monitoring tools can check the service is up) and the small endpoint the UI uses to ask "do I need to log in?".

When you open the UI, it asks for the token and remembers it in your browser. The token then rides along with every request the UI makes.

If you're writing your own tooling: pass `Authorization: Bearer <token>` on every HTTP request. For WebSocket connections from browser code (which can't set headers), pass `?token=<token>` in the URL or use a `bearer.<token>` subprotocol — both are accepted.

### Shutdown and logs

The container handles `docker stop` gracefully: it closes connections to your back-office cleanly and writes any pending data to disk before exiting. Logs go to standard output and standard error — whatever you use to collect Docker logs will pick them up.

### Upgrading later

```sh
docker pull ocpp-sim:<new-tag>     # or rebuild locally
docker stop ocpp-sim
docker rm ocpp-sim
docker run … ocpp-sim:<new-tag>    # same volume, same environment
```

The database schema updates itself on first boot of the new version. Your data carries over.
