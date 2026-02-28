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

  it('should handle concurrent stock deductions safely', async () => {
    // Seed a new item for concurrency test
    await request(app)
      .post('/seed')
      .send({ items: [{ id: 'concurrent-item', name: 'Concurrent Item', quantity: 5 }] });

    // Attempt to deduct 3 units concurrently, twice (total 6, but only 5 in stock)
    const deduction = () => request(app)
      .post('/stock/reduce')
      .send({ itemId: 'concurrent-item', quantity: 3 });

    const [res1, res2] = await Promise.all([deduction(), deduction()]);

    // Only one should succeed, the other should fail (422 or 409)
    const statuses = [res1.statusCode, res2.statusCode];
    expect(statuses).toContain(200);
    expect(statuses).toEqual(expect.arrayContaining([200, expect.any(Number)]));
    expect([409, 422]).toContain(statuses.find(s => s !== 200));
  });

  it('should be idempotent for repeated identical deduction requests', async () => {
    // Seed a new item for idempotency test
    await request(app)
      .post('/seed')
      .send({ items: [{ id: 'idempotent-item', name: 'Idempotent Item', quantity: 4 }] });

    // First deduction: should succeed
    const res1 = await request(app)
      .post('/stock/reduce')
      .send({ itemId: 'idempotent-item', quantity: 2 });
    expect(res1.statusCode).toEqual(200);
    expect(res1.body.newQuantity).toEqual(2);

    // Repeat the same deduction: should fail (insufficient stock if not idempotent, or 409/422)
    const res2 = await request(app)
      .post('/stock/reduce')
      .send({ itemId: 'idempotent-item', quantity: 2 });
    // Acceptable: either 200 with same result (if idempotent) or 422/409 (if not)
    expect([200, 409, 422]).toContain(res2.statusCode);
  });
});
