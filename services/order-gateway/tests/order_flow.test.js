const request = require('supertest');
const app = require('../index');
const jwt = require('jsonwebtoken');

// Mock dependencies
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    on: jest.fn(),
    connect: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    disconnect: jest.fn()
  })
}));

jest.mock('amqplib', () => ({
  connect: jest.fn().mockResolvedValue({
    createChannel: jest.fn().mockResolvedValue({
      assertQueue: jest.fn(),
      sendToQueue: jest.fn()
    })
  })
}));

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key';

describe('Order Gateway - Order Flow (Phase 2)', () => {
  let redisClientMock;
  let token;

  beforeAll(() => {
    // Get the mock instance
    const { createClient } = require('redis');
    redisClientMock = createClient();
    
    // Valid token
    token = jwt.sign(
      { userId: 'student-123', username: 'student', role: 'student' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('POST /order with Fast-Fail Cache Check', () => {

    it('should reject when item is out of stock (Redis returns 0)', async () => {
      redisClientMock.get.mockResolvedValue('0');

      const response = await request(app)
        .post('/order')
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId: 'spaghetti', quantity: 2 });

      expect(response.status).toBe(422);
      expect(response.body.error).toContain('rejected: Item out of stock');
      expect(response.body.fastRejection).toBe(true);
    });

    it('should reject when item is missing in cache (Redis returns null)', async () => {
      redisClientMock.get.mockResolvedValue(null);

      const response = await request(app)
        .post('/order')
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId: 'unknown-item' });

      expect(response.status).toBe(422);
      expect(response.body.fastRejection).toBe(true);
    });

    it('should accept when item has stock (Redis returns > 0)', async () => {
      redisClientMock.get.mockResolvedValue('50');

      const response = await request(app)
        .post('/order')
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId: 'spaghetti', quantity: 1 });

      expect(response.status).toBe(202);
      expect(response.body.message).toBe('Order received and being processed');
      expect(response.body.status).toBe('accepted');
      expect(response.body).toHaveProperty('orderId');
    });

    it('should return 400 when itemId is missing', async () => {
        const response = await request(app)
          .post('/order')
          .set('Authorization', `Bearer ${token}`)
          .send({ quantity: 1 });
  
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('itemId is required');
      });

  });

});
