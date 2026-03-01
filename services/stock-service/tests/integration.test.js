/**
 * Integration tests for Stock Service.
 * Run against the live docker-compose stack.
 * Requires: stock-service (localhost:3003), Postgres, Redis
 *
 * Tests:
 *  - Health endpoint (200 UP / 503 in chaos)
 *  - Metrics endpoint (Prometheus format)
 *  - Chaos toggle (GET + POST)
 *  - Stock list, seed, get, reduce, and over-reduce (422)
 *  - Optimistic locking / concurrent deduction safety
 */
const axios = require('axios');

const STOCK_URL = process.env.STOCK_SERVICE_URL || 'http://localhost:3003';

describe('Stock Service - Integration Tests', () => {

  // ─── Health ────────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('should return 200 with status UP when chaos is off', async () => {
      await axios.post(`${STOCK_URL}/chaos`, { enable: false });

      const res = await axios.get(`${STOCK_URL}/health`);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('UP');
      expect(res.data.service).toBe('stock-service');
    });
  });

  // ─── Metrics ───────────────────────────────────────────────────────────────

  describe('GET /metrics', () => {
    it('should return Prometheus-format metrics with custom counters', async () => {
      const res = await axios.get(`${STOCK_URL}/metrics`);
      expect(res.status).toBe(200);
      expect(res.data).toMatch(/^#\s(HELP|TYPE)|^[a-zA-Z_]/m);
      expect(res.data).toContain('stock_reduce_total');
      expect(res.data).toContain('stock_reduce_failed_total');
    });
  });

  // ─── Chaos ─────────────────────────────────────────────────────────────────

  describe('Chaos toggle', () => {
    afterEach(async () => {
      await axios.post(`${STOCK_URL}/chaos`, { enable: false });
    });

    it('GET /chaos should report chaosMode status', async () => {
      const res = await axios.get(`${STOCK_URL}/chaos`);
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('chaosMode');
      expect(res.data.service).toBe('stock-service');
    });

    it('POST /chaos with enable:true should activate chaos and return 503 on /health', async () => {
      const toggle = await axios.post(`${STOCK_URL}/chaos`, { enable: true });
      expect(toggle.data.chaosMode).toBe(true);

      try {
        await axios.get(`${STOCK_URL}/health`);
        fail('Expected 503');
      } catch (err) {
        expect(err.response.status).toBe(503);
        expect(err.response.data.status).toBe('DOWN');
      }
    });

    it('POST /chaos with enable:false should restore service to UP', async () => {
      await axios.post(`${STOCK_URL}/chaos`, { enable: true });
      await axios.post(`${STOCK_URL}/chaos`, { enable: false });

      const res = await axios.get(`${STOCK_URL}/health`);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('UP');
    });
  });

  // ─── Stock CRUD ────────────────────────────────────────────────────────────

  describe('Stock endpoints', () => {
    const TEST_ITEM_ID = `integ-item-${Date.now()}`;

    it('GET /stock/:id should return 404 for unknown item', async () => {
      try {
        await axios.get(`${STOCK_URL}/stock/totally-unknown-item-xyz`);
        fail('Expected 404');
      } catch (err) {
        expect(err.response.status).toBe(404);
      }
    });

    it('POST /seed should create a stock item', async () => {
      const res = await axios.post(`${STOCK_URL}/seed`, {
        items: [{ id: TEST_ITEM_ID, name: 'Integration Test Item', quantity: 20 }],
      });
      expect(res.status).toBe(200);
    });

    it('GET /stock/:id should return seeded quantity', async () => {
      const res = await axios.get(`${STOCK_URL}/stock/${TEST_ITEM_ID}`);
      expect(res.status).toBe(200);
      expect(res.data.quantity).toBe(20);
    });

    it('GET /stock should list items including the seeded one', async () => {
      const res = await axios.get(`${STOCK_URL}/stock`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      const found = res.data.find((i) => i.id === TEST_ITEM_ID);
      expect(found).toBeDefined();
    });

    it('POST /stock/reduce should decrement quantity', async () => {
      const res = await axios.post(`${STOCK_URL}/stock/reduce`, {
        itemId: TEST_ITEM_ID,
        quantity: 5,
      });
      expect(res.status).toBe(200);
      expect(res.data.newQuantity).toBe(15);
    });

    it('POST /stock/reduce should return 422 when quantity is insufficient', async () => {
      try {
        await axios.post(`${STOCK_URL}/stock/reduce`, {
          itemId: TEST_ITEM_ID,
          quantity: 9999,
        });
        fail('Expected 422');
      } catch (err) {
        expect(err.response.status).toBe(422);
      }
    });

    it('concurrent deductions should not over-commit stock (optimistic lock)', async () => {
      // Seed a tight-stock item: only 3 units
      const lockItemId = `lock-item-${Date.now()}`;
      await axios.post(`${STOCK_URL}/seed`, {
        items: [{ id: lockItemId, name: 'Lock Test Item', quantity: 3 }],
      });

      // Fire two deductions of 2 each concurrently (total 4 > 3)
      const deduct = () =>
        axios
          .post(`${STOCK_URL}/stock/reduce`, { itemId: lockItemId, quantity: 2 })
          .then((r) => r.status)
          .catch((e) => e.response.status);

      const [s1, s2] = await Promise.all([deduct(), deduct()]);

      // Exactly one should succeed (200) and the other should fail (409 or 422)
      expect([s1, s2]).toContain(200);
      const failStatus = [s1, s2].find((s) => s !== 200);
      expect([409, 422]).toContain(failStatus);
    });
  });
});
