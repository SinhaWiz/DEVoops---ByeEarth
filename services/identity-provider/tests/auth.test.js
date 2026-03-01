const request = require('supertest');
const app = require('../index');
const jwt = require('jsonwebtoken');

describe('Identity Provider - Auth Flow', () => {

  describe('POST /login', () => {
    it('should issue a JWT token with valid credentials', async () => {
      const response = await request(app)
        .post('/login')
        .send({ username: 'student1', password: 'password123' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.username).toBe('student1');

      // Verify the token structure
      const decoded = jwt.decode(response.body.token);
      expect(decoded.username).toBe('student1');
      expect(decoded.role).toBe('student');
    });

    it('should return 401 for invalid credentials', async () => {
      const response = await request(app)
        .post('/login')
        .send({ username: 'student1', password: 'wrong-password' });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });

    it('should return 400 for missing credentials', async () => {
      const response = await request(app)
        .post('/login')
        .send({ username: 'student1' }); // Missing password

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Username and password required');
    });
  });

  describe('GET /verify', () => {
    let validToken;

    beforeAll(async () => {
      const loginRes = await request(app)
        .post('/login')
        .send({ username: 'student1', password: 'password123' });
      validToken = loginRes.body.token;
    });

    it('should return 200 and valid = true for a valid token', async () => {
      const response = await request(app)
        .get('/verify')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.decoded.username).toBe('student1');
    });

    it('should return 401 for an invalid token', async () => {
      const response = await request(app)
        .get('/verify')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.valid).toBe(false);
    });

    it('should return 401 for missing authorization header', async () => {
      const response = await request(app).get('/verify');
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  describe('Health Check', () => {
    it('should return 200 UP', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('UP');
    });
  });

  describe('Rate Limiter — 3 attempts per minute per Student ID', () => {
    // The rate limiter skips when NODE_ENV === 'test'.
    // We temporarily set it to 'development' so skip() returns false.
    // The skip function is evaluated per-request, so no module reload is needed.
    let savedNodeEnv;

    beforeAll(() => {
      savedNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
    });

    afterAll(() => {
      process.env.NODE_ENV = savedNodeEnv;
    });

    it('should allow the first 3 attempts then block the 4th with 429', async () => {
      // Use a username not touched by any other test block, so the limiter
      // store is guaranteed clean for this key.
      const username = 'ratelimit-testuser';

      // Attempts 1–3: any non-429 response is acceptable
      // (401 because the user doesn't exist — but it still counts towards the limit)
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await request(app)
          .post('/login')
          .send({ username, password: 'wrong-password' });
        expect(res.status).not.toBe(429);
      }

      // Attempt 4: must be rate-limited
      const res = await request(app)
        .post('/login')
        .send({ username, password: 'wrong-password' });
      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/too many login attempts/i);
    });

    it('should rate-limit per username, not globally (different users are independent)', async () => {
      // Exhaust the limit for userA
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/login')
          .send({ username: 'ratelimit-userA', password: 'x' });
      }

      // userB should still be able to attempt a login (not blocked by userA's limit)
      const res = await request(app)
        .post('/login')
        .send({ username: 'ratelimit-userB', password: 'x' });
      expect(res.status).not.toBe(429);
    });
  });

});
