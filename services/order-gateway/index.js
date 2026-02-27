require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key';

app.use(cors());
app.use(express.json());

// Main health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: 'order-gateway' });
});

// Implementation for Phase 1: Authentication Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

// Protected routes (Phase 2 preview)
app.post('/order', authMiddleware, (req, res) => {
  res.status(201).json({ 
    message: 'Order received and being validated', 
    user: req.user 
  });
});

// Start listening
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Order Gateway running on port ${PORT}`);
  });
}

// Export for tests
module.exports = app;
