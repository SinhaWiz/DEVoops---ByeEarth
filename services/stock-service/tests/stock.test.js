const request = require('supertest');
const app = require('../index');
const { Sequelize, DataTypes } = require('sequelize');

// We use a separate in-memory sqlite or a test postgres if available.
// For simplicity in this env, we might just assume Postgres is reachable if we run with the docker-compose.
// But usually for unit tests we mock or use sqlite.
// Given the prompt's focus on "Postgres-backed", let's try to hit the DB if possible, or mock the model.

jest.mock('../index', () => {
  const original = jest.requireActual('../index');
  // We can let it run and it will fail if no DB, but let's try to mock the specific calls for "unit" test
  return original;
});

describe('Stock Service API', () => {
  beforeAll(async () => {
    // Wait for DB sync if needed
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
