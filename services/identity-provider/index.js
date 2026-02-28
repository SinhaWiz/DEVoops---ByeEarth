require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const promClient = require('prom-client');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key';

// Prometheus Metrics Setup
promClient.collectDefaultMetrics();

const loginSuccessCounter = new promClient.Counter({
  name: 'login_success_total',
  help: 'Total number of successful logins',
});

const loginFailedCounter = new promClient.Counter({
  name: 'login_failed_total',
  help: 'Total number of failed login attempts',
});

const tokenVerifyCounter = new promClient.Counter({
  name: 'token_verify_total',
  help: 'Total number of token verification requests',
});

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

// Mock users for development
const mockUsers = [
  {
    userId: 'student-123',
    username: 'student1',
    passwordHash: bcrypt.hashSync('password123', 10),
    role: 'student'
  },
  {
    userId: 'admin-456',
    username: 'admin',
    passwordHash: bcrypt.hashSync('adminpassword', 10),
    role: 'admin'
  }
];

// Rate Limiter for Login (per Student ID / username, 3 attempts per minute)
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // Limit each key to 3 attempts per minute
  keyGenerator: (req) => req.body?.username || req.ip, // Rate-limit per username
  message: { error: 'Too many login attempts, please try again after 1 minute' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test', // Skip in test/CI environments
});

app.use(cors());
app.use(express.json());

// Chaos mode flag
let chaosMode = false;

// Root route
app.get('/', (req, res) => {
  res.status(200).json({ service: 'identity-provider', status: chaosMode ? 'DEGRADED' : 'UP', endpoints: ['/health', '/login', '/verify', '/metrics', '/chaos'] });
});

// Main health endpoint
app.get('/health', (req, res) => {
  if (chaosMode) {
    return res.status(503).json({ status: 'DOWN', service: 'identity-provider', chaos: true });
  }
  res.status(200).json({ status: 'UP', service: 'identity-provider' });
});

// Chaos endpoint — GET returns status, POST toggles
app.get('/chaos', (req, res) => {
  res.status(200).json({ service: 'identity-provider', chaosMode });
});

app.post('/chaos', (req, res) => {
  const { enable } = req.body;
  chaosMode = enable !== undefined ? !!enable : !chaosMode;
  console.log(`[Chaos] identity-provider chaos mode: ${chaosMode}`);
  res.status(200).json({ service: 'identity-provider', chaosMode });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// Chaos guard middleware for functional endpoints
const chaosGuard = (req, res, next) => {
  if (chaosMode) {
    return res.status(503).json({ error: 'Service in chaos mode', service: 'identity-provider' });
  }
  next();
};

// Implementation for Phase 1: Login & JWT Issuance
app.post('/login', chaosGuard, loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = mockUsers.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    loginFailedCounter.inc();
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Generate JWT
  const token = jwt.sign(
    { userId: user.userId, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  res.status(200).json({
    token,
    user: { userId: user.userId, username: user.username, role: user.role }
  });
  loginSuccessCounter.inc();
});

// Verification Endpoint for other services
app.get('/verify', chaosGuard, (req, res) => {
  tokenVerifyCounter.inc();
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
