# DEVoops — ByeEarth 🍱

A resilient, fully-observable microservices platform for the IUT Cafeteria — built to survive the Ramadan rush that brought the old monolith down.

---

## ⚡ Quick Start

```bash
# 1. Bring up all 13 containers (builds images on first run)
docker compose up -d --build

# 2. Wait ~30 s for services to pass their health checks, then seed the DB
npm run seed

# 3. Open the student UI
open http://localhost:3000
```

> **Node 18+ required** for the seed script (uses native `fetch`).  
> Everything else runs inside Docker — no local Node needed.

---

## 🔐 Test Credentials

| Role | Username | Password |
|---|---|---|
| Student | `student1` | `password123` |
| Admin | `admin` | `adminpassword` |

---

## 🌐 Service URLs

| Service | URL | Notes |
|---|---|---|
| **Student UI** | [localhost:3000](http://localhost:3000) | Login → order → live tracker |
| **Admin Dashboard** | [localhost:3000/admin](http://localhost:3000/admin) | Health grid, chaos controls, latency alert |
| **Identity Provider** | [localhost:3001](http://localhost:3001) | JWT issuance + rate-limiting |
| **Order Gateway** | [localhost:3002](http://localhost:3002) | Fast-fail entry point |
| **Stock Service** | [localhost:3003](http://localhost:3003) | Postgres inventory (optimistic lock) |
| **Kitchen Queue** | [localhost:3004](http://localhost:3004) | RabbitMQ consumer + retry logic |
| **Notification Hub** | [localhost:3005](http://localhost:3005) | Socket.io real-time updates |
| **Grafana** | [localhost:3006](http://localhost:3006) | `admin` / `admin` — 12-panel dashboard |
| **Prometheus** | [localhost:9090](http://localhost:9090) | Metrics + alert rules |
| **Alertmanager** | [localhost:9093](http://localhost:9093) | Slack / email routing |
| **RabbitMQ UI** | [localhost:15672](http://localhost:15672) | `guest` / `guest` |

---

## 🏗️ Architecture

```
Browser
  │
  ├─ Next.js Frontend (3000)
  │    ├── /api/identity-provider/*  ─► Identity Provider (3001)
  │    ├── /api/order-gateway/*      ─► Order Gateway (3002)
  │    ├── /api/stock-service/*      ─► Stock Service (3003)
  │    ├── /api/kitchen-queue/*      ─► Kitchen Queue (3004)
  │    └── Socket.io                 ─► Notification Hub (3005)
  │
  └─ /admin  ─► Admin Dashboard (same Next.js app)

Order Gateway (3002)
  ├── Redis fast-fail check (stock:{id})
  ├── JWT auth verify → Identity Provider
  └── Publish → RabbitMQ [orders_queue]

Kitchen Queue (3004) ← RabbitMQ consumer
  ├── Immediate ACK (async processing)
  ├── POST /stock/reduce → Stock Service (3003)
  │     ├── Postgres optimistic lock (version field)
  │     └── Redis cache sync
  ├── Retry: up to 3× with exponential back-off (transient errors)
  └── Publish → RabbitMQ [notifications_queue]

Notification Hub (3005) ← RabbitMQ consumer
  └── Socket.io emit → connected browser

Prometheus (9090) ─► scrapes all 5 services every 15 s
Grafana (3006)    ─► pre-provisioned 12-panel dashboard
Alertmanager (9093) ─► GatewayHighLatency / ServiceDown / HighOrderFailureRate
```

---

## 🔄 Real-Time Order Flow

| Step | Where | Detail |
|---|---|---|
| **1. Fast-Fail** | Order Gateway + Redis | Stock 0 → reject in `<50 ms`, no DB hit |
| **2. Accept** | Order Gateway + RabbitMQ | Enqueue, return `202 Accepted` in `<2 s` |
| **3. In Kitchen** | Kitchen Queue | Immediate ACK, status notification emitted |
| **4. Stock Verify** | Stock Service | Atomic Postgres update with optimistic lock; on `409` kitchen retries up to 3× |
| **5. Notify** | Notification Hub → Socket.io | Browser tracker advances: Pending → In Kitchen → Stock Verified → Ready / Rejected |

---

## 🧪 Testing

### Run all unit + integration tests

```bash
# Test a single service
cd services/identity-provider && npm test

# Or run every service from the root
for svc in identity-provider order-gateway stock-service kitchen-queue notification-hub; do
  echo "▶ $svc" && (cd services/$svc && npm test)
done
```

### Re-seed the database (reset quantities)

```bash
npm run seed
```

The seed script upserts 19 menu items (mains, sides, drinks, desserts) — safe to run as many times as you like.

### Smoke-test the full order flow with curl

```bash
# 1. Login — get a JWT
TOKEN=$(curl -s -X POST http://localhost:3001/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"student1","password":"password123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

echo "Token: $TOKEN"

# 2. Check stock
curl -s http://localhost:3003/stock | jq '.[] | {id, name, quantity}'

# 3. Place an order
curl -s -X POST http://localhost:3002/order \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"itemId":"burger","quantity":1,"orderId":"smoke-test-001"}'

# 4. Check latency stats on the gateway
curl -s http://localhost:3002/latency-stats | jq
```

### Test rate-limiting (identity provider)

```bash
# 4th attempt within a minute → 429
for i in 1 2 3 4; do
  echo "Attempt $i:"
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"student1","password":"wrongpass"}'
  echo
done
```

### Trigger chaos mode

```bash
# Enable chaos on stock-service
curl -s -X POST http://localhost:3003/chaos \
  -H 'Content-Type: application/json' \
  -d '{"enable":true}'

# Place an order — kitchen-queue will retry then give up
curl -s -X POST http://localhost:3002/order \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"itemId":"ramen","quantity":1,"orderId":"chaos-test-001"}'

# Recover
curl -s -X POST http://localhost:3003/chaos \
  -H 'Content-Type: application/json' \
  -d '{"enable":false}'
```

---

## 📊 Observability

### Grafana (pre-provisioned)
Open [localhost:3006](http://localhost:3006) (`admin` / `admin`) — the **IUT Cafeteria** dashboard loads automatically.

**12 panels:**
- Orders accepted / rejected / processed / retried / failed / notifications pushed
- Gateway request rate (req/s)
- Gateway latency p50 / p95 / p99 with 1 s alert threshold
- Login success / failed
- Stock reductions / failures

### Prometheus alert rules (`monitoring/alerts.yml`)

| Alert | Condition | Severity |
|---|---|---|
| `GatewayHighLatency` | 30 s rolling avg > 1 s for 30 s | warning |
| `ServiceDown` | `up == 0` for 1 min | critical |
| `HighOrderFailureRate` | failed / accepted > 10 % over 5 min | warning |

### Alertmanager (`monitoring/alertmanager.yml`)
Routes all alerts to **Slack** and **email**. Set these env vars before `docker compose up` to activate real delivery:

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
export SMTP_FROM="alerts@yourdomain.com"
export SMTP_TO="oncall@yourdomain.com"
export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="587"
export SMTP_USERNAME="you@gmail.com"
export SMTP_PASSWORD="your-app-password"
```

Without these, the stack still boots — Alertmanager logs delivery errors but does not crash.

---

## 🛡️ Resilience Features

| Feature | Where | Detail |
|---|---|---|
| **JWT Auth** | Order Gateway | All order routes protected; 401 on missing/invalid token |
| **Rate Limiting** | Identity Provider | 3 login attempts / min per Student ID |
| **Redis Fast-Fail** | Order Gateway | Instant 422 if Redis says stock = 0 |
| **Idempotency Keys** | Order Gateway + Redis | `order:processed:{orderId}` with 24 h TTL prevents duplicate processing |
| **Optimistic Locking** | Stock Service | Sequelize `version: true`; concurrent updates get `409 Conflict` |
| **Async ACK** | Kitchen Queue | RabbitMQ message ACK'd immediately; processing happens in background |
| **Retry + Back-off** | Kitchen Queue | Up to 3 retries on transient errors (5xx / 409); exponential delay (2 s, 4 s, 6 s); 422 = permanent failure, no retry |
| **Chaos Mode** | All 5 services | `POST /chaos {"enable":true}` makes a service return 503 — test fault handling live |
| **Visual Latency Alert** | Admin Dashboard | 30 s rolling ring buffer; banner turns red when avg > 1 s |
| **Docker Healthchecks** | docker-compose.yml | All 13 containers; `depends_on: condition: service_healthy` ensures correct startup order |

---

## 📂 Project Structure

```
.
├── docker-compose.yml            # Full 13-container stack
├── package.json                  # Root — exposes `npm run seed`
├── scripts/
│   └── seed.js                   # Seeds 19 menu items via REST
├── monitoring/
│   ├── prometheus.yml            # Scrape config + alert rules wiring
│   ├── alerts.yml                # Prometheus alert rules (3 rules)
│   ├── alertmanager.yml          # Slack + email routing
│   └── grafana/
│       ├── provisioning/         # Auto-loads datasource + dashboard
│       └── dashboards/
│           └── cafeteria.json    # 12-panel Grafana dashboard
├── services/
│   ├── frontend/                 # Next.js 16 (React 19, TypeScript, Tailwind)
│   ├── identity-provider/        # JWT issuance, bcrypt, rate-limiting
│   ├── order-gateway/            # Fast-fail, idempotency, RabbitMQ publish
│   ├── stock-service/            # Postgres + Sequelize (optimistic lock) + Redis cache
│   ├── kitchen-queue/            # RabbitMQ consumer, retry logic
│   └── notification-hub/         # Socket.io real-time push
└── .github/
    └── workflows/
        ├── ci.yml                # Matrix build + lint (frontend) + test
        └── integration-test.yml  # Full docker compose stack smoke test
```

---

## ⚙️ CI/CD

GitHub Actions runs on every push to `main`:

| Job | Steps |
|---|---|
| **ci.yml** (matrix across 6 services) | `npm ci` → build → ESLint (frontend only) → Jest |
| **integration-test.yml** | `docker compose up` → wait for health → run integration tests → tear down |

Build fails if any test fails or the frontend has ESLint errors.

---

## 🗃️ Data Model

### StockItem (PostgreSQL — `stock-service`)

| Column | Type | Notes |
|---|---|---|
| `id` | STRING (PK) | e.g. `"burger"` |
| `name` | STRING | Display name |
| `quantity` | INTEGER | Validated `>= 0` |
| `version` | INTEGER | Optimistic lock counter |
| `createdAt` | TIMESTAMP | Sequelize auto |
| `updatedAt` | TIMESTAMP | Sequelize auto |

### Users (in-memory — `identity-provider`)
Hardcoded for dev. Passwords stored as bcrypt hashes (cost factor 10).

---

*Generated for DevSprint 2026. Problem statement: `problem_statement.txt`.*
