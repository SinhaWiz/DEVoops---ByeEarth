const request = require('supertest');
const app = require('../index');
const jwt = require('jsonwebtoken');

// Mock Redis and MQ because we are running in a CI environment
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    on: jest.fn(),
    connect: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    quit: jest.fn(),
  }),
}));

jest.mock('amqplib', () => ({
  connect: jest.fn().mockResolvedValue({
    createChannel: jest.fn().mockResolvedValue({
      assertQueue: jest.fn(),
      sendToQueue: jest.fn(),
    }),
  }),
}));

const redis = require('redis');
const amqp = require('amqplib');
const redisClient = redis.createClient();

const JWT_SECRET = 'super_secret_dev_key';
const validToken = jwt.sign(
  { userId: 'student-123', username: 'student', role: 'student' },
  JWT_SECRET
);

describe('Order Gateway - Phase 2 Order Flow', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject an order instantly if stock is missing (null) in Redis', async () => {
    redisClient.get.mockResolvedValue(null);

    const response = await request(app)
      .post('/order')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ itemId: 'pizza-1' });

    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/not found in inventory cache/);
  });

  it('should reject an order instantly if stock is 0 in Redis', async () => {
    redisClient.get.mockResolvedValue('0');

    const response = await request(app)
      .post('/order')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ itemId: 'pizza-1', quantity: 1 });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('Stock exhausted');
  });

  it('should accept an order and return 202 if stock is available', async () => {
    redisClient.get.mockResolvedValue('10');

    const response = await request(app)
      .post('/order')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ itemId: 'pizza-1', quantity: 2 });

    expect(response.status).toBe(202);
    expect(response.body.message).toBe('Order received and being validated');
    expect(response.body).toHaveProperty('orderId');
  });

  it('should return 400 if itemId is missing from request', async () => {
    const response = await request(app)
      .post('/order')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ quantity: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('itemId is required');
  });

});
