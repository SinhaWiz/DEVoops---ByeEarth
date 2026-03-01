/**
 * Integration tests for Kitchen Queue.
 * Run against the live docker-compose stack.
 * Requires: kitchen-queue HTTP server (localhost:3004), RabbitMQ (localhost:5672), Redis (localhost:6379)
 *
 * Tests:
 *  - Health endpoint (200 UP / 503 in chaos)
 *  - Metrics endpoint (Prometheus format)
 *  - Chaos toggle (GET + POST)
 *  - End-to-end: publish order → receive final notification via RabbitMQ
 */
const axios = require('axios');
const amqp = require('amqplib');

const KITCHEN_URL = process.env.KITCHEN_QUEUE_URL || 'http://localhost:3004';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const ORDER_QUEUE = 'orders_queue';
const NOTIFICATION_QUEUE = 'notifications_queue';

describe('Kitchen Queue - Integration Tests', () => {

  // ─── Health ────────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('should return 200 with status UP when chaos is off', async () => {
      // Ensure chaos is off first
      await axios.post(`${KITCHEN_URL}/chaos`, { enable: false });

      const res = await axios.get(`${KITCHEN_URL}/health`);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('UP');
      expect(res.data.service).toBe('kitchen-queue');
    });
  });

  // ─── Metrics ───────────────────────────────────────────────────────────────

  describe('GET /metrics', () => {
    it('should return Prometheus-format metrics', async () => {
      const res = await axios.get(`${KITCHEN_URL}/metrics`);
      expect(res.status).toBe(200);
      // Prometheus text format starts with # HELP or a metric name
      expect(res.data).toMatch(/^#\s(HELP|TYPE)|^[a-zA-Z_]/m);
      // Custom kitchen-queue counters must be present
      expect(res.data).toContain('orders_processed_total');
      expect(res.data).toContain('orders_failed_total');
    });
  });

  // ─── Chaos ─────────────────────────────────────────────────────────────────

  describe('Chaos toggle', () => {
    afterEach(async () => {
      // Always restore chaos off after each chaos test
      await axios.post(`${KITCHEN_URL}/chaos`, { enable: false });
    });

    it('GET /chaos should report chaosMode status', async () => {
      const res = await axios.get(`${KITCHEN_URL}/chaos`);
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('chaosMode');
      expect(res.data.service).toBe('kitchen-queue');
    });

    it('POST /chaos with enable:true should activate chaos', async () => {
      const res = await axios.post(`${KITCHEN_URL}/chaos`, { enable: true });
      expect(res.status).toBe(200);
      expect(res.data.chaosMode).toBe(true);
    });

    it('should return 503 on /health when chaos is active', async () => {
      await axios.post(`${KITCHEN_URL}/chaos`, { enable: true });

      try {
        await axios.get(`${KITCHEN_URL}/health`);
        fail('Expected 503');
      } catch (err) {
        expect(err.response.status).toBe(503);
        expect(err.response.data.status).toBe('DOWN');
      }
    });

    it('POST /chaos with enable:false should deactivate chaos', async () => {
      await axios.post(`${KITCHEN_URL}/chaos`, { enable: true });
      const res = await axios.post(`${KITCHEN_URL}/chaos`, { enable: false });
      expect(res.status).toBe(200);
      expect(res.data.chaosMode).toBe(false);

      // Health should be 200 again
      const health = await axios.get(`${KITCHEN_URL}/health`);
      expect(health.status).toBe(200);
      expect(health.data.status).toBe('UP');
    });
  });

  // ─── End-to-end order processing ───────────────────────────────────────────

  describe('End-to-end: order published → notification emitted', () => {
    let connection;
    let channel;

    beforeAll(async () => {
      connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertQueue(ORDER_QUEUE, { durable: true });
      await channel.assertQueue(NOTIFICATION_QUEUE, { durable: true });
    }, 15000);

    afterAll(async () => {
      if (channel) await channel.close();
      if (connection) await connection.close();
    });

    it('should process an order and emit a final notification within 15s', async () => {
      const orderId = `integ-test-${Date.now()}`;
      const orderMsg = {
        orderId,
        itemId: 'spaghetti',
        quantity: 1,
        userId: 'test-student',
      };

      await channel.purgeQueue(NOTIFICATION_QUEUE);

      // Set up notification listener before publishing
      const notifPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('No final notification received within 15s')),
          15000
        );

        channel.consume(NOTIFICATION_QUEUE, (msg) => {
          if (!msg) return;
          const data = JSON.parse(msg.content.toString());
          channel.ack(msg);

          if (data.orderId === orderId && ['ORDER_SUCCESS', 'ORDER_FAILED'].includes(data.type)) {
            clearTimeout(timeout);
            resolve(data);
          }
        }, { noAck: false });
      });

      const sendTime = Date.now();
      channel.sendToQueue(ORDER_QUEUE, Buffer.from(JSON.stringify(orderMsg)), { persistent: true });

      const notif = await notifPromise;
      const elapsed = Date.now() - sendTime;

      // Async processing must take at least 3s (setTimeout in worker)
      expect(elapsed).toBeGreaterThanOrEqual(3000);
      expect(['ORDER_SUCCESS', 'ORDER_FAILED']).toContain(notif.type);
      expect(notif.orderId).toBe(orderId);
    }, 30000);
  });
});
