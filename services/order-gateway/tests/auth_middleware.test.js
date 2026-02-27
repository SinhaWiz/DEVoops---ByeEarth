const request = require('supertest');
const app = require('../index');
const jwt = require('jsonwebtoken');

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

  describe('Protected Route Access (201)', () => {
    it('should allow access with a valid token', async () => {
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

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message', 'Order received and being validated');
      expect(response.body.user.username).toBe('student');
    });
  });

});
