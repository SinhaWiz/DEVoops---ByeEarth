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

});
