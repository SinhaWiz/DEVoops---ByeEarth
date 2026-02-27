const request = require('supertest');
const { app, sequelize, redisClient } = require('../index');

describe('Stock Service API', () => {
  beforeAll(async () => {
    // Sync DB and connect Redis for tests
    try {
      await sequelize.sync({ force: true }); // Wipe clean for testing
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
    } catch (err) {
      console.warn('Test backend services not available. Some tests may fail.', err.message);
    }
  });

  afterAll(async () => {
    // Cleanup connections to avoid Jest leak warnings
    await sequelize.close();
    if (redisClient.isOpen) {
      await redisClient.disconnect();
    }
  });

  it('should return 404 for non-existent item', async () => {
    const res = await request(app).get('/stock/ghost-item');
    expect(res.statusCode).toEqual(404);
  });

  it('should seed stock items', async () => {
    const res = await request(app)
      .post('/seed')
      .send({
        items: [{ id: 'test-item', name: 'Test Item', quantity: 10 }]
      });
    expect(res.statusCode).toEqual(200);
  });

  it('should return stock quantity', async () => {
    const res = await request(app).get('/stock/test-item');
    expect(res.statusCode).toEqual(200);
    expect(res.body.quantity).toEqual(10);
  });

  it('should reduce stock', async () => {
    const res = await request(app)
      .post('/stock/reduce')
      .send({ itemId: 'test-item', quantity: 3 });
    expect(res.statusCode).toEqual(200);
    expect(res.body.newQuantity).toEqual(7);
  });

  it('should reject reduction if insufficient stock', async () => {
    const res = await request(app)
      .post('/stock/reduce')
      .send({ itemId: 'test-item', quantity: 10 });
    expect(res.statusCode).toEqual(422);
  });
});
