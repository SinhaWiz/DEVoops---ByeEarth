require('dotenv').config();
const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const cors = require('cors');

const { createClient } = require('redis');
const client = require('prom-client');
// Prometheus Metrics Setup
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

// Custom metrics example (can be extended as needed)
const stockReduceCounter = new client.Counter({
  name: 'stock_reduce_total',
  help: 'Total number of stock reductions',
});

const stockReduceFailedCounter = new client.Counter({
  name: 'stock_reduce_failed_total',
  help: 'Total number of failed stock reductions',
});

// /metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

const app = express();
const PORT = process.env.PORT || 3003;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Redis Client Connection
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.log('Redis Client Error', err));

// Environment Variables
const PG_USER = process.env.PGUSER || 'dev';
const PG_PASSWORD = process.env.PGPASSWORD || 'devpassword';
const PG_HOST = process.env.PGHOST || 'localhost';
const PG_PORT = process.env.PGPORT || 5432;
const PG_DB = process.env.PGDATABASE || 'cafeteria';

const sequelize = new Sequelize(PG_DB, PG_USER, PG_PASSWORD, {
  host: PG_HOST,
  port: PG_PORT,
  dialect: 'postgres',
  logging: false, // Set to true for debugging
});

// Model Definition with Optimistic Locking
const StockItem = sequelize.define('StockItem', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  quantity: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0,
    },
  },
  name: {
    type: DataTypes.STRING,
  },
  version: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  }
}, {
  timestamps: true,
  version: true,
});

app.use(cors());
app.use(express.json());

// Helper: Sync Redis Cache with DB for an item
async function syncRedis(id, quantity) {
  try {
    // We only update if Redis is connected
    if (redisClient.isOpen) {
      // Use the same key pattern as order-gateway
      await redisClient.set(`stock:${id}`, quantity.toString());
    }
  } catch (err) {
    console.error(`Failed to sync Redis for ${id}:`, err.message);
  }
}

// Health Check
app.get('/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({ 
      status: 'UP', 
      database: 'connected',
      redis: redisClient.isOpen ? 'connected' : 'disconnected'
    });
  } catch (err) {
    res.status(500).json({ status: 'DOWN', database: err.message });
  }
});

// GET Stock for an item
app.get('/stock/:id', async (req, res) => {
  try {
    const item = await StockItem.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.status(200).json({ id: item.id, quantity: item.quantity, version: item.version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Reduce Stock (Atomic & Optimistic)
app.post('/stock/reduce', async (req, res) => {
  const { itemId, quantity } = req.body;

  if (!itemId || quantity === undefined) {
    stockReduceFailedCounter.inc();
    return res.status(400).json({ error: 'itemId and quantity are required' });
  }

  try {
    const item = await StockItem.findByPk(itemId);
    if (!item) {
      stockReduceFailedCounter.inc();
      return res.status(404).json({ error: 'Item not found' });
    }

    if (item.quantity < quantity) {
      stockReduceFailedCounter.inc();
      return res.status(422).json({ error: 'Insufficient stock' });
    }

    item.quantity -= quantity;
    await item.save();

    // Side effect: Update Redis Cache for Fast-Fail consistency
    await syncRedis(item.id, item.quantity);

    stockReduceCounter.inc();
    res.status(200).json({ 
      message: 'Stock reduced successfully', 
      id: item.id, 
      newQuantity: item.quantity,
      version: item.version
    });

  } catch (err) {
    stockReduceFailedCounter.inc();
    if (err.name === 'SequelizeOptimisticLockError') {
      res.status(409).json({ error: 'Conflict: Concurrent update detected. Please retry.' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Seed Stock for Testing
app.post('/seed', async (req, res) => {
  const { items } = req.body; 
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Items array required' });
  }

  try {
    for (const item of items) {
      await StockItem.upsert(item);
      // Sync each item to Redis during seeding
      await syncRedis(item.id, item.quantity);
    }
    res.status(200).json({ message: 'Stock seeded successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync Database and Start
async function init() {
  try {
    await redisClient.connect();
    await sequelize.sync({ alter: true }); 
    console.log('Postgres Database & Redis Cache synced');
    
    app.listen(PORT, () => {
      console.log(`Stock Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to init Stock Service:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  init();
}

module.exports = { app, sequelize, redisClient };
