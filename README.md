# DEVoops---ByeEarth

**Overview**
- **Project**: IUT Cafeteria — convert a failing monolith into a resilient microservices system.
- **Goal**: Implement containerized services (Identity Provider, Order Gateway, Stock Service, Kitchen Queue, Notification Hub), a SPA student UI, and an admin dashboard. Fulfill all security, resilience, observability, and CI requirements from the problem statement.

**Requirements (Summary)**
- **Auth**: Token handshake via Identity Provider; protected routes must return 401 for missing/invalid tokens.
- **Ordering Flow**: Gateway validates token, checks cache, rejects instantly on zero stock; orders are acknowledged quickly (<2s) and processed asynchronously.
- **Stock Safety**: Strong concurrency control (optimistic locking or equivalent) to avoid oversell and support idempotency for retries/partial failures.
- **Resilience**: Services must be isolated (containers), tolerate partial failures, and expose health & metrics endpoints.
- **Observability**: Health endpoints (200/503), metrics (orders, failures, avg latency), and logging.
- **CI/CD & Tests**: Unit tests for order validation and stock deduction; pipeline runs tests on pushes to `main` and fails on test failures.
- **UI**: SPA for students (login, place order, live status updates). Admin dashboard with health grid, live metrics, and a chaos toggle to kill services.
- **Extras**: Docker Compose runnable system, optional cloud deployment, monitoring alerts and rate-limiter bonus.

**Suggested Architecture**
- **Services**:
  - **Identity Provider**: AuthN/AuthZ issuing JWTs.
  - **Order Gateway**: API gateway, token validation, fast cache lookup, request routing.
  - **Stock Service**: Canonical inventory with transactional updates and concurrency control.
  - **Kitchen Queue**: Message-driven worker (ack now, process later).
  - **Notification Hub**: Real-time push (WebSocket or server-sent events) to UIs.
- **Data stores**: Relational DB for stock (Postgres), fast cache (Redis) in front of Stock Service, and durable message queue/stream (RabbitMQ, Redis Streams, or Kafka-lite) for Kitchen Queue.
- **Containerization**: Docker for each service; `docker-compose.yml` to wire services for judges' local run.

**Implementation Plan (Milestones & Tasks)**
- **Phase 0 — Repo & infra (1 day)**: Create monorepo layout, `docker-compose.yml`, basic CI config (GitHub Actions). Acceptance: `docker compose up` starts empty services; CI pipeline created.
- **Phase 1 — Identity & Auth (1-2 days)**: Implement Identity Provider (JWT issuance, login rate-limiter). Tests: auth token issuance and protected-route rejection (401).
- **Phase 2 — Order Gateway & Cache (2 days)**: Gateway endpoints, token validation middleware, Redis cache check for stock; immediate rejection if cache shows zero. Tests: gateway rejects unauthorized and rejects zero-stock quickly.
- **Phase 3 — Stock Service (2-3 days)**: Postgres-backed service with strict concurrency control (optimistic locking via row version or SELECT...FOR UPDATE where appropriate). Expose health & metrics. Tests: concurrent stock deductions, idempotency behavior.
- **Phase 4 — Kitchen Queue & Async Processing (2 days)**: Implement message queue consumer, immediate order ack (<2s) and separate processing job (3-7s). Ensure retry & idempotency. Tests: ack time, eventual processing.
- **Phase 5 — Notification Hub & UI (2-3 days)**: WebSocket-based real-time updates; SPA (React/Vite) that logs in, places order, shows status funnel. Admin dashboard shows service health, metrics, and chaos toggle endpoints.
- **Phase 6 — Observability & CI (1-2 days)**: Add health/metrics endpoints (Prometheus metrics format), structured logs, Grafana dashboards (optional). Complete CI pipeline to run unit tests and linter on push.
- **Phase 7 — Hardening & Bonus (1-2 days)**: Add rate-limiting, chaos experiments, container readiness probes, automated alerts (e.g., email/Slack) for gateway latency breaches, optional cloud deploy.

**Acceptance Criteria (per milestone)**
- All services run with `docker compose up` and expose documented ports.
- Auth flow: valid token needed; invalid/missing token returns 401.
- Ordering: gateway responds <2s with ack; eventual processing completes and notifications arrive in UI.
- Stock safety: no oversell under concurrent load (automated concurrency test).
- Observability: health endpoints and metrics present for each service.
- CI: tests run on push to `main`; build fails on test failures.

**Testing Plan**
- **Unit tests**: Order validation, stock deduction logic.
- **Integration tests**: Gateway→Stock cache behavior, end-to-end order placement to Kitchen processing.
- **Load test**: Simulate Ramadan rush (hundreds of concurrent orders) to validate stability and DB contention.
- **Chaos test**: Programmatically kill a service and confirm system recovers and notifications/errors handled gracefully.

**CI/CD**
- Use GitHub Actions (or GitLab CI) to run unit tests, lint, and build container images. Example pipelines:
  - `push` to feature branches: run tests and build images.
  - `push` to `main`: run tests, build images, and optionally push to registry.

**Observability & Monitoring**
- Expose `/health` and `/metrics` on each service.
- Collect metrics with Prometheus; dashboard with Grafana.
- Logging: structured JSON logs (stdout) for aggregation.

**Recommended Tech Stacks (best-fit options)**
- **Primary (fast iteration + rich ecosystem)**:
  - Backend: Node.js + NestJS or Express (TypeScript)
  - Async: BullMQ (Redis) or RabbitMQ for queues
  - Cache: Redis
  - DB: PostgreSQL
  - Frontend: React + Vite
  - Real-time: WebSockets (Socket.IO or ws)
  - Container/orchestration: Docker Compose (judges), Kubernetes for cloud
  - CI: GitHub Actions
- **Alternative (lightweight, high-performance)**:
  - Backend: Go (Gin/Fiber) for low-latency services
  - Queues: NATS or Redis Streams
  - Frontend: Svelte or React
- **Python option (rapid development, clear async support)**:
  - Backend: FastAPI + Uvicorn (async)
  - Async tasks: Celery (Redis/RabbitMQ)

**Are Java-based stacks appropriate?**
- **Yes — Suitable When**:
  - The team has Java/Spring expertise.
  - Strong typing, mature ecosystem, and production-grade libraries are required.
  - You need transactional integrity and mature observability integrations (Spring Boot Actuator, Micrometer, Sleuth).
- **Trade-offs**:
  - **Pros**: Spring Boot provides all required pieces (security, Actuator, metrics, JWT support, DB integration). Concurrency control and transactional semantics are well supported. Excellent for robust, long-lived services.
  - **Cons**: Higher memory footprint and longer startup times; slower to iterate compared to Node/Go. More boilerplate unless using Spring Boot with Kotlin or Spring WebFlux (reactive).
- **Recommendation**: Use Spring Boot if team is comfortable with Java and you favor stability and strong frameworks. For a time-boxed sprint or fast MVP, Node.js/TypeScript or Go may deliver faster with fewer infra costs.

**Next Steps I can do now (pick one)**
- Draft the initial `docker-compose.yml` wiring minimal services.
- Scaffold the `Identity Provider` and `Order Gateway` skeletons.
- Create a CI pipeline template (`.github/workflows/ci.yml`) with test steps.

---
Generated from: DevSprint 2026 Problem Statement (DevSprint 2026 Problem Statement.pdf)

For the detailed plan and implementation tasks, see `README.md` in the repo root.
# DEVoops---ByeEarth