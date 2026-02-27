# DEVoops — ByeEarth: IUT Cafeteria Microservices

A high-performance, resilient, and containerized microservices platform for the IUT Cafeteria, converted from a failing monolith to solve seasonal scale issues (Ramadan rush).

## 🚀 Quick Start

To start the entire system (6 services + 3 databases) in one command:
```bash
docker compose up -d --build
```

### 🔐 Testing Credentials
| User Type | Username | Password |
| --- | --- | --- |
| **Student** | `student1` | `password123` |
| **Admin** | `admin` | `adminpassword` |

---

## 🏗️ Architecture Overiew

### Services Stack
- **Frontend** ([localhost:3000](http://localhost:3000)): Next.js 16 (React 19) SPA with real-time Socket.io and `react-hot-toast` notifications.
- **Identity Provider** ([localhost:3001](http://localhost:3001)): Issues JWTs, employs Bcrypt hashing, and login rate-limiting.
- **Order Gateway** ([localhost:3002](http://localhost:3002)): Entry point for orders; implements **"Fast-Fail" logic** via Redis.
- **Stock Service** ([localhost:3003](http://localhost:3003)): Postgres-backed inventory with **Optimistic Locking** (row versioning).
- **Kitchen Queue** (Internal): RabbitMQ consumer that finalizes transactions and manages fulfillment.
- **Notification Hub** ([localhost:3005](http://localhost:3005)): WebSocket server for real-time user updates.

### Persistent Stores
- **PostgreSQL**: Source of truth for inventory and orders.
- **Redis**: High-speed cache for fast-fail stock checks and order gateway performance.
- **RabbitMQ**: Message broker for asynchronous, decoupled order processing.

---

## 🍱 Real-Time Order Flow

1.  **Fast-Fail Check**: Gateway checks the **Redis Cache** immediately. If stock is 0, the order is rejected in `<50ms`.
2.  **Async Acceptance**: If stock exists, the order is enqueued to **RabbitMQ** and an `HTTP 202 Accepted` is returned to the user in `<2s`.
3.  **Kitchen Processing**: The **Kitchen Worker** consumes the message, calls the **Stock Service** to perform an atomic Postgres update with optimistic locking.
4.  **Real-Time Update**: Once stock is confirmed, a message is sent to the **Notification Hub**, which pushes a **Socket.io** event to the student's dashboard.

---

## 📂 Project Structure

```text
/services
  /frontend           - Next.js SPA (Student Dashboard)
  /identity-provider  - AuthN/AuthZ (JWT issuance)
  /order-gateway      - Fast-Fail Gatekeeper & Cache management
  /stock-service      - Postgres Inventory (Optimistic Locking)
  /kitchen-queue      - Async worker (RabbitMQ consumer)
  /notification-hub   - Real-time Socket.io server
/docker-compose.yml   - Full stack orchestration
/.github/workflows    - CI/CD pipeline (Jest tests & Docker builds)
```

## 🧪 Observability & Health

Every service exposes a `/health` endpoint for monitoring:
- **Identity**: `http://localhost:3001/health`
- **Gateway**: `http://localhost:3002/health`
- **Stock**: `http://localhost:3003/health` (Checks DB + Redis connection)

**RabbitMQ Management UI**: [http://localhost:15672](http://localhost:15672) (User: `guest`, Pass: `guest`)

---

## 🛠️ Implementation Details

### **Fast-Fail with Redis**
The Gateway doesn't wait for the database. It queries Redis for instant inventory verification, preventing database contention during peak load.

### **Optimistic Locking**
The Stock Service uses Sequelize `version: true`. Every stock reduction validates that no other worker has modified the row simultaneously.
```javascript
// if version differs from memory, Postgres rejects the UPDATE automatically
await item.save(); 
```

### **Resilience & CI**
- **Dockerized**: 9 containers isolated by specialized networks.
- **GitHub Actions**: Automated pipeline runs Jest/Supertest suites on every push to `main`.
- **Node 20 Support**: Fully migrated to Node 20-alpine for security and Next.js 16 compatibility.

CI pipeline is configured to build and test each service on every push to the `main` branch.

Generated from: DevSprint 2026 Problem Statement (DevSprint 2026 Problem Statement.pdf)

For the detailed plan and implementation tasks, see `README.md` in the repo root.
# DEVoops---ByeEarth