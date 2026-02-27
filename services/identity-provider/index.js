require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key';

// Mock users for development
const mockUsers = [
  {
    id: 'student-123',
    username: 'student',
    passwordHash: bcrypt.hashSync('password123', 10),
    role: 'student'
  },
  {
    id: 'admin-456',
    username: 'admin',
    passwordHash: bcrypt.hashSync('adminpassword', 10),
    role: 'admin'
  }
];

// Rate Limiter for Login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 attempts per window
  message: { error: 'Too many login attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
app.use(express.json());

// Main health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: 'identity-provider' });
});

// Implementation for Phase 1: Login & JWT Issuance
app.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = mockUsers.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Generate JWT
  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  res.status(200).json({
    token,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

// Verification Endpoint for other services
app.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.status(200).json({ valid: true, decoded });
  } catch (err) {
    res.status(401).json({ valid: false, error: err.message });
  }
});

// Start listening if not required as a module (useful for testing)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Identity Provider running on port ${PORT}`);
  });
}

// Export for tests
module.exports = app;
