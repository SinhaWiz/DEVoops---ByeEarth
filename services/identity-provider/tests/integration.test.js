/**
 * Integration tests for Identity Provider.
 * Run against the live docker-compose stack (localhost:3001).
 */
const axios = require('axios');

const BASE_URL = process.env.IDENTITY_PROVIDER_URL || 'http://localhost:3001';

describe('Identity Provider - Integration Tests', () => {

  describe('GET /health', () => {
    it('should return 200 with status UP', async () => {
      const res = await axios.get(`${BASE_URL}/health`);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('UP');
      expect(res.data.service).toBe('identity-provider');
    });
  });

  describe('POST /login', () => {
    it('should return a JWT token for valid credentials', async () => {
      const res = await axios.post(`${BASE_URL}/login`, {
        username: 'student1',
        password: 'password123'
      });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('token');
      expect(res.data.user.username).toBe('student1');
      expect(res.data.user.role).toBe('student');
    });

    it('should return 401 for invalid credentials', async () => {
      try {
        await axios.post(`${BASE_URL}/login`, {
          username: 'student1',
          password: 'wrongpassword'
        });
        fail('Should have thrown');
      } catch (err) {
        expect(err.response.status).toBe(401);
        expect(err.response.data.error).toBe('Invalid credentials');
      }
    });

    it('should return 400 when password is missing', async () => {
      try {
        await axios.post(`${BASE_URL}/login`, { username: 'student1' });
        fail('Should have thrown');
      } catch (err) {
        expect(err.response.status).toBe(400);
      }
    });
  });

  describe('GET /verify', () => {
    let token;

    beforeAll(async () => {
      const res = await axios.post(`${BASE_URL}/login`, {
        username: 'student1',
        password: 'password123'
      });
      token = res.data.token;
    });

    it('should verify a valid token', async () => {
      const res = await axios.get(`${BASE_URL}/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(res.status).toBe(200);
      expect(res.data.valid).toBe(true);
      expect(res.data.decoded.username).toBe('student1');
    });

    it('should reject an invalid token', async () => {
      try {
        await axios.get(`${BASE_URL}/verify`, {
          headers: { Authorization: 'Bearer fake-token' }
        });
        fail('Should have thrown');
      } catch (err) {
        expect(err.response.status).toBe(401);
        expect(err.response.data.valid).toBe(false);
      }
    });

    it('should reject a request with no auth header', async () => {
      try {
        await axios.get(`${BASE_URL}/verify`);
        fail('Should have thrown');
      } catch (err) {
        expect(err.response.status).toBe(401);
      }
    });
  });

  describe('Full login → verify round-trip', () => {
    it('should login and then successfully verify the issued token', async () => {
      // Login
      const loginRes = await axios.post(`${BASE_URL}/login`, {
        username: 'admin',
        password: 'adminpassword'
      });
      expect(loginRes.status).toBe(200);
      const { token } = loginRes.data;
      expect(token).toBeTruthy();

      // Verify
      const verifyRes = await axios.get(`${BASE_URL}/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data.valid).toBe(true);
      expect(verifyRes.data.decoded.role).toBe('admin');
    });
  });
});
