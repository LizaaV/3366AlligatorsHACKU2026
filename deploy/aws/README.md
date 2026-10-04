# Deploy to AWS: one EC2 server, Docker, SSH

The fastest way to get Constellation online with our AWS credits: one EC2 server running the
existing Docker stack (`deploy/docker-compose.yml`: nginx + the SPA in front of FastAPI). The
code goes from a laptop to the server over SSH with `rsync` and is built there. No GitHub step,
no container registry, no load balancer. About 20 minutes the first time, about a minute for
each redeploy after that. The server is in Hong Kong, next to our users.

```
laptop ──rsync over SSH──> EC2 (Ubuntu 24.04, Docker)            ap-east-1 (Hong Kong)
                             ├─ frontend: nginx :80  ── SPA, /api/* proxied ─┐
browser ──http :80/443────>  │                                              │
                             └─ backend: FastAPI :8000 (internal only) <────┘
                                   └─ volume earth-data: cache, rendered views, runs DB
                                   └─ reads Sentinel-2 from Earth Search S3 (us-west-2), cached on disk
```

## Why these choices

| Choice | Why |
| --- | --- |
| **Region `ap-east-1` (Hong Kong)** | Our users are in Hong Kong. Every page load, click and the live answer stream go between them and the server, so being a few ms away instead of about 150 ms (Oregon) is what people feel. The trade-off: the Sentinel-2 images live in us-west-2, so the first look at a place reads them across the Pacific and is slower. The server caches every rendered view and pass list on disk, places are rendered ahead when saved, and `warm.sh` pre-renders the demo places, so repeat views are instant. Reading them costs nothing extra: data coming into EC2 is free. |
| **One EC2 instance + Docker Compose** | The stack already runs with one command. The backend must be a single process (its locks are in-process), so there's nothing to scale out for a demo. |
| **`t3.xlarge` (4 vCPU, 16 GB)** | The first image build (Python geo wheels + npm) and rasterio reads want memory. `t3.large` (2 vCPU, 8 GB) also works: the bootstrap adds 4 GB swap. |
| **Elastic IP** | The address stays the same after a stop/start, so links and `PUBLIC_BASE_URL` stay valid. |
| **rsync over SSH, build on the server** | Deploys exactly what is on your machine, including uncommitted work, without pushing anywhere. Docker layer cache means a code-only change rebuilds in seconds. |

**Rough cost (on-demand; Hong Kong prices run somewhat above the US ones, so check the AWS pricing page for ap-east-1 or Cost Explorer before relying on these):** `t3.xlarge` from about $0.17/hour (about $120/month in us-west-2 if left on 24/7, more in Hong Kong), `t3.large` about half that; 40 GB gp3 disk about $3/month; the public IPv4 address about $3.60/month. **Stop the instance when not demoing** to save credits: disk and IP are kept, only compute stops.

## What you need (once)

- AWS account with the credits applied, and an IAM user (not the root user) with EC2 permissions. Create an access key for it.
- On your laptop: [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), `ssh`, `rsync` (macOS/Linux have both; on Windows use WSL).
- `aws configure`: paste the access key, region `ap-east-1`.
- Enable the Hong Kong region once (it is opt-in): `aws account enable-region --region-name ap-east-1`, or console → account menu → Account → AWS Regions → Asia Pacific (Hong Kong) → Enable. It takes a few minutes; `launch.sh` checks it. Prefer not to? `REGION=ap-southeast-1 ./deploy/aws/launch.sh` (Singapore, about 35 ms from Hong Kong, no opt-in).
- An Anthropic API key for the agent (optional: without it, the scripted preset still works).

## Steps

### 1. Create the server (5 min)

```bash
./deploy/aws/launch.sh
```

It creates the SSH key `~/.ssh/constellation.pem`, a security group (80/443 open to everyone, 22 only to your current IP), the instance with Docker installed by `cloud-init.sh` on first boot, and an Elastic IP. It prints the IP and the next command. It is safe to run again: it reuses what exists (and allows SSH from your new IP if you moved).

Teammates who need SSH: send them the `.pem` privately (never commit it), and have them run `launch.sh` once from their network to open port 22 for their IP, or add their IP in the console (EC2 → Security Groups → `constellation-web` → inbound rules).

<details><summary>No AWS CLI? The same in the console</summary>

EC2 → Launch instance: name `constellation`, Ubuntu Server 24.04 LTS (x86), `t3.xlarge`, create key pair `constellation` (ED25519, .pem), security group allowing SSH from "My IP" plus HTTP and HTTPS from anywhere, 40 GB gp3, Advanced details → User data: paste `deploy/aws/cloud-init.sh`. Then Elastic IPs → Allocate → Associate with the instance.
</details>

### 2. Production settings (2 min)

```bash
cp deploy/aws/env.prod.example deploy/aws/.env.prod    # git-ignored
# edit: ANTHROPIC_API_KEY=..., keep EARTH_IMPL=real, set DAILY_SPEND_CAP_USD to what you can afford
```

### 3. Ship (first build: about 5 to 10 min)

```bash
SSH_KEY=~/.ssh/constellation.pem ./deploy/aws/ship.sh <ip>
```

It waits for Docker on the server, rsyncs the repo to `/opt/constellation`, uploads `.env.prod` as `backend/.env`, writes `deploy/.env` (`PUBLIC_BASE_URL=http://<ip>`), runs `docker compose up -d --build` and checks `/api/health`. Then open `http://<ip>/`.

### 4. Check

- `http://<ip>/api/health` returns `{"status":"ok"}`.
- Chat: search a town, pick a pin, switch the date range to 5 yrs, ask a question. The answer's images open on the right.
- Save a place, wait a minute, then flick through its dates: they come from the cache.

### 5. Warm the demo places (the evening before)

```bash
SSH_KEY=~/.ssh/constellation.pem ./deploy/aws/warm.sh <ip> <presenter-user-id>
```

It queues every band of every pass (recent and 5 years) for each of that user's saved places, and the server renders them in the background. The presenter's id is in their browser: DevTools console → `localStorage.getItem('constellation.userId')`. Without an id it warms the shared `demo` user (Hoo Hok Wai).

### 6. Redeploy after a change (about 1 min)

Run the same `ship.sh` command. Only changed files are copied and only changed image layers rebuild. Data (cache, runs, places) is in the `earth-data` volume and survives.

## Day-to-day on the server

```bash
ssh -i ~/.ssh/constellation.pem ubuntu@<ip>
cd /opt/constellation
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f backend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --force-recreate backend   # after editing backend/.env
```

| Task | How |
| --- | --- |
| Save credits | `aws ec2 stop-instances --instance-ids <id>`; `start-instances` before the demo (same IP, data kept). |
| Backup before the demo | EC2 → Volumes → Create snapshot (or `aws ec2 create-snapshot --volume-id <vol>`). |
| Billing alarm | Billing → Budgets → a monthly budget at, say, 50% of the credits, with email alerts. |
| Stop AI spending fast | Set `AGENT_MODE=preset` in `deploy/aws/.env.prod` and re-run `ship.sh`. |
| Tear down | Terminate the instance, release the Elastic IP, delete the key pair and security group `constellation-web`. |

## HTTPS (optional, 5 min)

Plain `http://<ip>` is fine for a demo. For a padlock without buying a domain, use the free `sslip.io` name for the IP (`3-12-45-67.sslip.io` resolves to `3.12.45.67`) and Caddy for the certificate:

1. Redeploy with nginx on another port: `HTTP_PORT=8080 PUBLIC_BASE_URL=https://3-12-45-67.sslip.io SSH_KEY=... ./deploy/aws/ship.sh <ip>`
2. On the server: `sudo apt-get install -y caddy`, then put this in `/etc/caddy/Caddyfile` and run `sudo systemctl reload caddy`:
   ```
   3-12-45-67.sslip.io {
       reverse_proxy localhost:8080 {
           flush_interval -1    # keep the live answer stream unbuffered
       }
   }
   ```

With our own domain, point an A record at the Elastic IP and use that name instead.

## Security notes

- Only nginx is public. The backend port is not published on the host.
- SSH is limited to the team's IPs; keys only, no passwords (Ubuntu default).
- Secrets live only in `deploy/aws/.env.prod` (git-ignored) and on the server in `backend/.env` (mode 600).
- `DAILY_SPEND_CAP_USD` and the per-user / per-IP run limits protect the Anthropic bill on a public URL.
- The Docker sandbox profile (`SANDBOX_IMPL=docker`) mounts the Docker socket; leave it off on a public server unless needed (see `deploy/README.md`).

## Later, if the demo becomes a product

Build images in CI and push to ECR (no build on the server), run on ECS or keep one EC2 with an Auto Scaling group of one for self-healing, put the SPA on S3 + CloudFront, and move `earth-data` to EFS or S3 so the server becomes disposable. None of that is needed for the hackathon.

## Tested

`ship.sh` was run end to end against a stand-in Ubuntu host over SSH: rsync, settings upload, `docker compose up --build`, health check. The deployed stack (nginx + backend images) then passed the same browser checks as local development: Chat tab, Library concepts, example triggers, 5-year date picker (60 monthly passes), circle undo, Back/Forward, artifacts panel. Background prefetch filled the view cache. The test build needed this sandbox's HTTPS proxy and CA certificate injected into the image builds; EC2 has direct internet and needs none of that. `launch.sh` and `cloud-init.sh` need a real AWS account and were checked for syntax only.
