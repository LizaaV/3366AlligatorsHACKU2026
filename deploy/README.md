# Deploy: one VM, one command

Brings up the whole app (React SPA + FastAPI) on any Linux VM with Docker. No cloud-specific tooling.

```
browser ──:80──> nginx (frontend container) ──/api/*──> backend:8000 (FastAPI, internal only)
                       └── serves the built SPA, history fallback to index.html
```

nginx is the single public entry point; the backend is not published on the host. The SPA calls `/api` on its own origin. The frontend image is built with `VITE_API_SOURCE=http` (Vite inlines it at build time), so the deployed app talks to the real backend instead of the scripted fixtures; set `VITE_API_SOURCE=fixture` in `deploy/.env` and rebuild to get the mock-only UI.

## 1. VM prerequisites

- Linux, about 4 vCPU / 8 GB RAM, 20 GB disk.
- Docker Engine with the Compose plugin (v2.24+): `docker compose version`.
  Quick install on Ubuntu/Debian: `curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER` (log out and in).
- Firewall / security group: open inbound TCP **80** (and **443** if you add HTTPS). Nothing else.
- Outbound internet (Anthropic API, STAC / Planetary Computer when `EARTH_IMPL=real`).

## 2. Clone and configure

```bash
git clone https://github.com/LizaaV/3366AlligatorsHACKU2026.git
cd 3366AlligatorsHACKU2026

cp backend/.env.example backend/.env      # then edit: ANTHROPIC_API_KEY, EARTH_IMPL, SANDBOX_IMPL, ...
cp deploy/.env.example deploy/.env        # then edit: PUBLIC_BASE_URL, HTTP_PORT
```

- `backend/.env` holds the app settings and secrets (git-ignored). See `backend/.env.example` and `docs/BUILD-PLAN.md` section 9. If it is missing the stack still boots with defaults (stub earth, no LLM key).
  Do not set `EARTH_DATA_DIR` or `CORS_ORIGINS` there; compose sets them.
- `deploy/.env` holds deploy-level values: `PUBLIC_BASE_URL` (e.g. `http://203.0.113.10` or `https://earth.example.com`, no trailing slash; it becomes the CORS origin), `HTTP_PORT` (default 80) and `VITE_API_SOURCE` (default `http`, build-time).

### Environment variables

| Variable | Where | Default | Meaning |
| --- | --- | --- | --- |
| `EARTH_IMPL` | `backend/.env` | `stub` | `stub` = offline Hoo Hok Wai preset, no network. `real` = Sentinel-2 via STAC (needs outbound internet). |
| `SANDBOX_IMPL` | `backend/.env` | `subprocess` | How agent-written scripts run. `docker` is not implemented yet. |
| `ANTHROPIC_API_KEY` | `backend/.env` | unset | LLM key; only read once the LLM agent lands (see `docs/BUILD-PLAN.md` section 9). |
| `SHARE_TTL_DAYS` | `backend/.env` | n/a yet | Planned (share links); ignored until implemented. |
| `RUNS_DB_PATH` | `backend/.env` | `$EARTH_DATA_DIR/runs.sqlite` | Run store location. Leave unset. |
| `EARTH_DATA_DIR` | compose | `/data` | Cache, rendered layers, memory, run DB (volume). Set by compose; do not override. |
| `CORS_ORIGINS` | compose | `["$PUBLIC_BASE_URL"]` | Set by compose from `PUBLIC_BASE_URL`. |
| `PUBLIC_BASE_URL` | `deploy/.env` | `http://localhost` | Public URL; CORS origin. |
| `HTTP_PORT` | `deploy/.env` | `80` | Host port of nginx. |
| `VITE_API_SOURCE` | `deploy/.env` | `http` | Frontend build arg: `http` real API, `fixture` mocks. Needs a rebuild. |

## 3. Start

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

First build takes a few minutes (Python geo wheels, npm install). Then open `http://<vm-ip>/`.

Check:

```bash
curl -s http://localhost/api/health        # {"status":"ok"}
docker compose -f deploy/docker-compose.yml ps
```

Verified on Docker Desktop (compose v2): the backend imports rasterio/pyproj/shapely/odc.stac/planetary_computer/pystac_client plus `earth` and `knowledge`; `/api/health`, SPA deep links (`/places`), `/api/knowledge/index`, the SSE run stream (`POST /api/runs`, delivered incrementally through nginx), the sandbox runner (as the non-root `app` user) and `/api/layers/...` PNGs from the data volume (surviving a container recreate) all work through port 80. Images: backend about 1.4 GB, frontend about 77 MB.

## 4. Day-to-day

```bash
# logs
docker compose -f deploy/docker-compose.yml logs -f backend
docker compose -f deploy/docker-compose.yml logs -f frontend

# update / redeploy
git pull
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

# changed only backend/.env? recreate the backend:
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --force-recreate backend

# stop (keeps data) / stop and wipe data volume
docker compose -f deploy/docker-compose.yml down
docker compose -f deploy/docker-compose.yml down -v
```

Dependencies are in their own image layer, so code-only redeploys are fast.

## Deploy on a fresh Ubuntu VM (checklist)

```bash
# 1. Docker (Ubuntu 22.04/24.04), then log out and in again
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER

# 2. Code and config
git clone https://github.com/LizaaV/3366AlligatorsHACKU2026.git && cd 3366AlligatorsHACKU2026
cp backend/.env.example backend/.env && nano backend/.env     # EARTH_IMPL=real, ANTHROPIC_API_KEY=... when needed
cp deploy/.env.example deploy/.env && nano deploy/.env        # PUBLIC_BASE_URL=http://<vm-public-ip>

# 3. Up
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

# 4. Check, then open TCP 80 (and 443 for HTTPS) in the cloud security group
curl -s localhost/api/health
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp     # only if ufw is active
```

Open `http://<vm-public-ip>/`. For a domain with HTTPS, follow the Caddy steps below.

## Data

Cache, rendered PNGs and memory live in the named volume `earth-agent_earth-data`, mounted at `/data` in the backend (`EARTH_DATA_DIR=/data`). It survives rebuilds and `down`; only `down -v` deletes it.

## HTTPS

Not needed for a demo at `http://<ip>`. For HTTPS, easiest is Caddy on the host (automatic certificates):

1. Point a DNS A record at the VM.
2. Set `HTTP_PORT=8080` in `deploy/.env` and `PUBLIC_BASE_URL=https://earth.example.com`, redeploy.
3. Install Caddy and use this `Caddyfile`:
   ```
   earth.example.com {
       reverse_proxy localhost:8080 {
           flush_interval -1      # do not buffer the SSE run stream
       }
   }
   ```
   `sudo systemctl reload caddy`. Ports 80 and 443 must be open for certificate issuance.

Alternative: nginx + certbot on the host in front of `localhost:8080` (keep `proxy_buffering off` and a long `proxy_read_timeout` for `/api/`), or put any provider load balancer / Cloudflare in front of port 80.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `docker compose` says unknown `additional_contexts` or `required` | Compose too old; install the Docker Compose plugin v2.24 or newer. |
| `frontend` never starts | It waits for a healthy backend: `docker compose -f deploy/docker-compose.yml logs backend`. |
| Port 80 already in use | Set `HTTP_PORT=8080` in `deploy/.env` and use `--env-file deploy/.env`. |
| Page loads, `/api` gives 502 | Backend crashed or still starting: `ps` and `logs backend`. |
| Run stream stalls or arrives all at once | Something in front of nginx is buffering. Disable buffering there (see HTTPS section). nginx here already has `proxy_buffering off`. |
| Settings changes ignored | `backend/.env` is only read on container (re)creation; use `up -d --force-recreate backend`. |
| Backend `OSError` loading rasterio/pyproj | Missing system library in the slim image; add only that package to `backend/Dockerfile` (`apt-get install`). |
| Disk filling up | `docker system df`; `docker image prune`. Cache lives in the `earth-data` volume. |

## Future: Docker sandbox (BUILD-PLAN M4 step 2)

Compose already defines an `internal` network, `earth-only` (no internet, no host access), joined by the backend. Sandbox containers (`earth-runner`) will join it to reach the earth service and nothing else (see `docs/HANDOFF-BACKEND.md` B2.1).

Note for that step: the backend then has to start sibling containers, which needs either the host Docker socket mounted into the backend (`/var/run/docker.sock`, effectively root on the VM; acceptable for a hackathon, not for production) or a separate small spawner service that owns the socket. The non-root `app` user in the backend image would also need access to that socket (group add). Until then `SANDBOX_IMPL=subprocess` runs scripts inside the backend container.
