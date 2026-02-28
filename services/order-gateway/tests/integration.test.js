/**
 * Integration tests for Order Gateway.
 * Run against the live docker-compose stack.
 * Requires: identity-provider (localhost:3001), order-gateway (localhost:3002),
 *           Redis (localhost:6379), RabbitMQ (localhost:5672)
 */
const axios = require('axios');
const { createClient } = require('redis');

const IDENTITY_URL = process.env.IDENTITY_PROVIDER_URL || 'http://localhost:3001';
const GATEWAY_URL = process.env.ORDER_GATEWAY_URL || 'http://localhost:3002';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe('Order Gateway - Integration Tests', () => {
  let redisClient;
  let studentToken;

  beforeAll(async () => {
    // Connect to Redis to seed stock
    redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();

    // Seed stock for test items
    await redisClient.set('stock:spaghetti', '50');
    await redisClient.set('stock:ramen', '5');
    await redisClient.set('stock:empty-item', '0');

    // Login via identity-provider to get a valid token
    const loginRes = await axios.post(`${IDENTITY_URL}/login`, {
      username: 'student1',
      password: 'password123'
    });
    studentToken = loginRes.data.token;
  }, 15000);

  afterAll(async () => {
    if (redisClient && redisClient.isOpen) {
      await redisClient.del('stock:spaghetti', 'stock:ramen', 'stock:empty-item');
      await redisClient.disconnect();
    }
  });

  describe('GET /health', () => {
    it('should return 200 with status UP', async () => {
      const res = await axios.get(`${GATEWAY_URL}/health`);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('UP');
    });
  });

  describe('Authentication enforcement', () => {
    it('should reject requests without a token with 401', async () => {
      try {
        await axios.post(`${GATEWAY_URL}/order`, { itemId: 'spaghetti' });
        fail('Should have thrown');
      } catch (err) {
        expect(err.response.status).toBe(401);
      }
    });

    it('should reject requests with an invalid token with 401', async () => {
      try {
        await axios.post(`${GATEWAY_URL}/order`,
          { itemId: 'spaghetti' },
          { headers: { Authorization: 'Bearer invalid-token-here' } }
        );
        fail('Should have thrown');
      } catch (err) {
        expect(err.response.status).toBe(401);
      }
    });
  });

  describe('POST /order - Fast-fail cache check', () => {
    it('should accept order when stock is available (202)', async () => {
      const res = await axios.post(`${GATEWAY_URL}/order`,
        { itemId: 'spaghetti', quantity: 1 },
        { headers: { Authorization: `Bearer ${studentToken}` } }
      );
      expect(res.status).toBe(202);
      expect(res.data.status).toBe('accepted');
      expect(res.data).toHaveProperty('orderId');
    });

    it('should reject order when stock is zero (422 fast-fail)', async () => {
      try {
        await axios.post(`${GATEWAY_URL}/order`,
          { itemId: 'empty-item', quantity: 1 },
          { headers: { Authorization: `Bearer ${studentToken}` } }
        );
        fail('Should have thrown');
      } catch (err) {
        expect(err.response.status).toBe(422);
        expect(err.response.data.fastRejection).toBe(true);
      }
    });

    it('should reject order for unknown item not in cache (422)', async () => {
      try {
        await axios.post(`${GATEWAY_URL}/order`,
          { itemId: 'nonexistent-item', quantity: 1 },
          { headers: { Authorization: `Bearer ${studentToken}` } }
        );
        fail('Should have thrown');
      } catch (err) {
        expect(err.response.status).toBe(422);
        expect(err.response.data.fastRejection).toBe(true);
      }
    });

    it('should reject order with missing itemId (400)', async () => {
      try {
        await axios.post(`${GATEWAY_URL}/order`,
          { quantity: 1 },
          { headers: { Authorization: `Bearer ${studentToken}` } }
        );
        fail('Should have thrown');
      } catch (err) {
        expect(err.response.status).toBe(400);
      }
    });
  });

  describe('End-to-end: login → order', () => {
    it('should complete the full login-then-order flow', async () => {
      // 1. Login
      const loginRes = await axios.post(`${IDENTITY_URL}/login`, {
        username: 'student1',
        password: 'password123'
      });
      expect(loginRes.status).toBe(200);
      const token = loginRes.data.token;

      // 2. Place order
      const orderRes = await axios.post(`${GATEWAY_URL}/order`,
        { itemId: 'ramen', quantity: 1 },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      expect(orderRes.status).toBe(202);
      expect(orderRes.data.message).toBe('Order received and being processed');
    });
  });
});
