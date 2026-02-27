const request = require('supertest');
const app = require('../index');
const jwt = require('jsonwebtoken');

// Mock Redis/MQ to avoid connection issues during middleware tests
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(true),
    get: jest.fn(),
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

describe('Order Gateway - Authentication Middleware', () => {

  describe('Protected Route Rejection (401)', () => {
    it('should reject a request with no token', async () => {
      const response = await request(app).post('/order').send({ itemId: 'pizza-1' });
      expect(response.status).toBe(401);
      expect(response.body.error).toMatch(/Unauthorized: No token provided/);
    });

    it('should reject a request with an invalid token', async () => {
      const response = await request(app)
        .post('/order')
        .set('Authorization', 'Bearer invalid-token')
        .send({ itemId: 'pizza-1' });

      expect(response.status).toBe(401);
      expect(response.body.error).toMatch(/Unauthorized: Invalid or expired token/);
    });
  });

  describe('Protected Route Access (202)', () => {
    it('should allow access with a valid token and return 202', async () => {
      // Mock redis to return stock
      const { createClient } = require('redis');
      createClient().get.mockResolvedValue('10');

      // Create a valid token manually for testing
      const token = jwt.sign(
        { userId: 'student-123', username: 'student', role: 'student' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .post('/order')
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId: 'pizza-1' });

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('message', 'Order received and being processed');
    });
  });

});
