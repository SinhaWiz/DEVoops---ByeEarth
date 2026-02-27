require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const redis = require('redis');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

// 1. Redis Client Initialization
const redisClient = redis.createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.log('Redis Client Error', err));

// 2. RabbitMQ Initialization
let mqChannel;
async function connectMQ() {
  try {
    const connection = await amqp.connect(RABBIT_URL);
    mqChannel = await connection.createChannel();
    await mqChannel.assertQueue('orders_queue', { durable: true });
    console.log('Connected to RabbitMQ');
  } catch (error) {
    console.error('RabbitMQ Connection Error:', error.message);
  }
}

app.use(cors());
app.use(express.json());

// Main health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: 'order-gateway' });
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

/**
 * Implementation for Phase 2: FAST REJECTION
 * 1. Authenticate (middleware)
 * 2. Check stock in Redis
 * 3. Reject instantly if stock is 0
 * 4. Queue if stock is available
 */
app.post('/order', authMiddleware, async (req, res) => {
  const { itemId, quantity = 1 } = req.body;

  if (!itemId) {
    return res.status(400).json({ error: 'itemId is required' });
  }

  try {
    // Phase 2: Check stock in Redis (Fast-Fail)
    const stockKey = `stock:${itemId}`;
    const currentStock = await redisClient.get(stockKey);

    // If stock is null (not seeded) or 0
    if (currentStock === null) {
      return res.status(422).json({ error: `Item ${itemId} not found in inventory cache` });
    }

    if (parseInt(currentStock) < quantity) {
      return res.status(422).json({ 
        error: 'Stock exhausted',
        itemId,
        available: parseInt(currentStock)
      });
    }

    // Success: Queue order and return 202
    const orderData = {
      orderId: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId: req.user.userId,
      username: req.user.username,
      itemId,
      quantity,
      timestamp: new Date().toISOString()
    };

    if (mqChannel) {
      mqChannel.sendToQueue('orders_queue', Buffer.from(JSON.stringify(orderData)), { persistent: true });
    } else {
       // Fallback for dev if MQ is not ready, but we should ideally error out if we want strong guarantees
       console.error('MQ Channel not available');
    }

    return res.status(202).json({
      message: 'Order received and being validated',
      orderId: orderData.orderId,
      status: 'pending'
    });

  } catch (error) {
    console.error('Order processing error:', error);
    res.status(500).json({ error: 'Internal server error processing order' });
  }
});

// Helper route for dev: Seed Redis with stock
app.post('/dev/seed-stock', async (req, res) => {
  const { items } = req.body; // e.g., { "pizza": 10, "ramen": 0 }
  try {
    for (const [id, count] of Object.entries(items)) {
      await redisClient.set(`stock:${id}`, count.toString());
    }
    res.json({ message: 'Stock seeded successfully', items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start initialization
(async () => {
  await redisClient.connect();
  await connectMQ();
  
  if (require.main === module) {
    app.listen(PORT, () => {
      console.log(`Order Gateway (Phase 2) running on port ${PORT}`);
    });
  }
})();

// Export for tests
module.exports = app;
