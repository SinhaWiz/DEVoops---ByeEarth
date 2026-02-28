require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { createClient } = require('redis');
const amqp = require('amqplib');
const promClient = require('prom-client');

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

// Prometheus Metrics Setup
promClient.collectDefaultMetrics();

const ordersAcceptedCounter = new promClient.Counter({
  name: 'orders_accepted_total',
  help: 'Total number of orders accepted (enqueued)',
});

const ordersRejectedCounter = new promClient.Counter({
  name: 'orders_rejected_total',
  help: 'Total number of orders rejected (fast-fail)',
});

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

app.use(cors());
app.use(express.json());

// Chaos mode flag
let chaosMode = false;

// Redis Client Connection
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.log('Redis Client Error', err));

// RabbitMQ Channel for Orders Queue
let orderChannel;
async function connectMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    orderChannel = await connection.createChannel();
    await orderChannel.assertQueue('orders_queue', { durable: true });
    console.log('Connected to RabbitMQ: orders_queue ready');
  } catch (err) {
    console.error('Failed to connect to RabbitMQ:', err.message);
  }
}

// Root route
app.get('/', (req, res) => {
  res.status(200).json({ service: 'order-gateway', status: chaosMode ? 'DEGRADED' : 'UP', endpoints: ['/health', '/order', '/seed-stock', '/metrics', '/chaos'] });
});

// Main health endpoint
app.get('/health', (req, res) => {
  if (chaosMode) {
    return res.status(503).json({ status: 'DOWN', service: 'order-gateway', chaos: true });
  }
  res.status(200).json({ status: 'UP', service: 'order-gateway' });
});

// Chaos endpoint
app.get('/chaos', (req, res) => {
  res.status(200).json({ service: 'order-gateway', chaosMode });
});

app.post('/chaos', (req, res) => {
  const { enable } = req.body;
  chaosMode = enable !== undefined ? !!enable : !chaosMode;
  console.log(`[Chaos] order-gateway chaos mode: ${chaosMode}`);
  res.status(200).json({ service: 'order-gateway', chaosMode });
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

// Authentication Middleware
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

// Chaos guard middleware
const chaosGuard = (req, res, next) => {
  if (chaosMode) {
    return res.status(503).json({ error: 'Service in chaos mode', service: 'order-gateway' });
  }
  next();
};

// Implementation for Phase 2: Order with Fast-Fail (Redis check)
app.post('/order', chaosGuard, authMiddleware, async (req, res) => {
  const { itemId, quantity = 1 } = req.body;

  if (!itemId) {
    return res.status(400).json({ error: 'itemId is required' });
  }

  try {
    // 1. Fast Stock Check (Redis)
    const stock = await redisClient.get(`stock:${itemId}`);
    
    // If stock is null (not seeded) or 0, reject immediately
    if (stock === null || parseInt(stock) <= 0) {
      ordersRejectedCounter.inc();
      return res.status(422).json({ 
        error: 'Order rejected: Item out of stock (fast-fail)',
        itemId,
        fastRejection: true
      });
    }

    // 2. Async Order Processing (RabbitMQ)
    const orderData = {
      orderId: `ord-${Date.now()}`,
      userId: req.user.userId,
      itemId,
      quantity,
      timestamp: new Date().toISOString()
    };

    if (orderChannel) {
      orderChannel.sendToQueue('orders_queue', Buffer.from(JSON.stringify(orderData)), { persistent: true });
    } else {
      console.warn('MQ channel not ready, order only logged locally');
    }

    ordersAcceptedCounter.inc();
    // Fast acknowledgement (<2s guaranteed)
    res.status(202).json({
      message: 'Order received and being processed',
      orderId: orderData.orderId,
      status: 'accepted'
    });

  } catch (err) {
    console.error('Order processing error:', err.message);
    res.status(500).json({ error: 'Internal server error while processing order' });
  }
});

// Mock Seeding Endpoint (Development Only)
app.post('/seed-stock', async (req, res) => {
  const { items } = req.body; // e.g. { "spaghetti": 50, "ramen": 0 }
  if (!items) return res.status(400).send('No items provided');
  
  for (const [id, count] of Object.entries(items)) {
    await redisClient.set(`stock:${id}`, count.toString());
  }
  res.status(200).send('Stock seeded successfully');
});

// Start service
async function startServer() {
  await redisClient.connect();
  await connectMQ();
  app.listen(PORT, () => {
    console.log(`Order Gateway running on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

// Export for tests
module.exports = app;
