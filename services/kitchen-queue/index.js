require('dotenv').config();

const amqp = require('amqplib');
const axios = require('axios');
const { createClient } = require('redis');


const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const STOCK_SERVICE_URL = process.env.STOCK_SERVICE_URL || 'http://localhost:3003';
const ORDER_QUEUE = 'orders_queue';
const NOTIFICATION_QUEUE = 'notifications_queue';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Redis client for idempotency
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

async function startWorker() {
  try {
    await redisClient.connect();
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue(ORDER_QUEUE, { durable: true });
    await channel.assertQueue(NOTIFICATION_QUEUE, { durable: true });
    
    channel.prefetch(1); // Process one message at a time
    console.log(`Kitchen Queue Worker started. Waiting for messages in ${ORDER_QUEUE}...`);

    channel.consume(ORDER_QUEUE, async (msg) => {
      if (msg !== null) {
        const orderData = JSON.parse(msg.content.toString());
        const { orderId, itemId, quantity, userId } = orderData;
        console.log(`[Queue] Received Order: ${orderId} for Item: ${itemId}`);

        // Idempotency check: skip if already processed
        const idempotencyKey = `order:processed:${orderId}`;
        const alreadyProcessed = await redisClient.get(idempotencyKey);
        if (alreadyProcessed) {
          console.log(`[Idempotency] Order ${orderId} already processed. Skipping.`);
          channel.ack(msg);
          return;
        }

        // 1. Immediate ack (simulate HTTP 202 to user)
        channel.ack(msg);

        // Send "in_kitchen" status notification
        channel.sendToQueue(NOTIFICATION_QUEUE, Buffer.from(JSON.stringify({
          userId,
          orderId,
          type: 'ORDER_STATUS',
          status: 'in_kitchen',
          message: `Your order for ${itemId} is being processed in the kitchen.`
        })), { persistent: true });

        // 2. Simulate async processing (3-7s delay)
        const processingDelay = 3000 + Math.floor(Math.random() * 4000); // 3-7s
        setTimeout(async () => {
          try {
            // Idempotency re-check (in case of race)
            const processed = await redisClient.get(idempotencyKey);
            if (processed) {
              console.log(`[Idempotency] (Delayed) Order ${orderId} already processed. Skipping.`);
              return;
            }
            // Call Stock Service to finalize reduction in Postgres (Source of Truth)
            const response = await axios.post(`${STOCK_SERVICE_URL}/stock/reduce`, {
              itemId: itemId,
              quantity: quantity
            });

            if (response.status === 200) {
              console.log(`[Success] Stock reduced for Order: ${orderId}. New stock: ${response.data.newQuantity}`);
              // Mark as processed (idempotency)
              await redisClient.set(idempotencyKey, '1', { EX: 24 * 60 * 60 }); // 1 day expiry
              ordersProcessedCounter.inc();

              // Send "stock_verified" status
              channel.sendToQueue(NOTIFICATION_QUEUE, Buffer.from(JSON.stringify({
                userId,
                orderId,
                type: 'ORDER_STATUS',
                status: 'stock_verified',
                message: `Stock verified for your order.`
              })), { persistent: true });

              // Notify User — Order Ready
              const successNotification = {
                userId,
                orderId,
                type: 'ORDER_SUCCESS',
                message: `Your order for ${itemId} is ready! Remaining stock: ${response.data.newQuantity}`,
                status: 'ready'
              };
              channel.sendToQueue(NOTIFICATION_QUEUE, Buffer.from(JSON.stringify(successNotification)), { persistent: true });
            }
          } catch (err) {
            if (err.response) {
              const status = err.response.status;
              const errorMsg = err.response.data.error || err.message;
              console.error(`[Error] ${status} from Stock Service for Order ${orderId}: ${errorMsg}`);
              if (status === 422 || status === 404) {
                // Item not found or Insufficient stock - Cannot be fulfilled
                console.error(`[Critical] Order ${orderId} failed fulfillment: ${errorMsg}`);
                // Mark as processed (idempotency)
                await redisClient.set(idempotencyKey, '1', { EX: 24 * 60 * 60 });
                ordersFailedCounter.inc();
                // Notify User of Failure
                const failureNotification = {
                  userId,
                  orderId,
                  type: 'ORDER_FAILED',
                  message: `Sorry, your order for ${itemId} failed: ${errorMsg}`,
                  status: 'rejected'
                };
                channel.sendToQueue(NOTIFICATION_QUEUE, Buffer.from(JSON.stringify(failureNotification)), { persistent: true });
              } else if (status === 409) {
                // Conflict (Optimistic Lock) - retry (requeue by sending to ORDER_QUEUE again)
                console.log(`[Retry] Conflict detected for ${orderId}. Re-queuing...`);
                ordersRetriedCounter.inc();
                channel.sendToQueue(ORDER_QUEUE, Buffer.from(JSON.stringify(orderData)), { persistent: true });
              } else {
                // Server error - retry (requeue by sending to ORDER_QUEUE again)
                ordersRetriedCounter.inc();
                channel.sendToQueue(ORDER_QUEUE, Buffer.from(JSON.stringify(orderData)), { persistent: true });
              }
            } else {
              console.error(`[Network Error] Could not reach Stock Service: ${err.message}`);
              ordersRetriedCounter.inc();
              channel.sendToQueue(ORDER_QUEUE, Buffer.from(JSON.stringify(orderData)), { persistent: true });
            }
          }
        }, processingDelay);
      }
    });

  } catch (err) {
    console.error('Failed to start Kitchen Queue Worker:', err.message);
    setTimeout(startWorker, 5000); // Retry connection
  }
}

// --- HTTP Server for health checks & metrics ---
const express = require('express');
const promClient = require('prom-client');
const cors = require('cors');
const httpApp = express();
const HTTP_PORT = process.env.PORT || 3004;

httpApp.use(cors());

// Prometheus Metrics Setup
promClient.collectDefaultMetrics();

// Chaos mode flag
let chaosMode = false;

const ordersProcessedCounter = new promClient.Counter({
  name: 'orders_processed_total',
  help: 'Total number of orders successfully processed',
});

const ordersFailedCounter = new promClient.Counter({
  name: 'orders_failed_total',
  help: 'Total number of orders that failed processing',
});

const ordersRetriedCounter = new promClient.Counter({
  name: 'orders_retried_total',
  help: 'Total number of orders re-queued for retry',
});

httpApp.get('/', (req, res) => {
  res.status(200).json({ service: 'kitchen-queue', status: chaosMode ? 'DEGRADED' : 'UP', endpoints: ['/health', '/metrics', '/chaos'] });
});

httpApp.get('/health', (req, res) => {
  if (chaosMode) {
    return res.status(503).json({ status: 'DOWN', service: 'kitchen-queue', chaos: true });
  }
  res.status(200).json({
    status: 'UP',
    service: 'kitchen-queue',
    redis: redisClient.isOpen ? 'connected' : 'disconnected'
  });
});

httpApp.use(require('express').json());

httpApp.get('/chaos', (req, res) => {
  res.status(200).json({ service: 'kitchen-queue', chaosMode });
});

httpApp.post('/chaos', (req, res) => {
  const { enable } = req.body;
  chaosMode = enable !== undefined ? !!enable : !chaosMode;
  console.log(`[Chaos] kitchen-queue chaos mode: ${chaosMode}`);
  res.status(200).json({ service: 'kitchen-queue', chaosMode });
});

httpApp.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

httpApp.listen(HTTP_PORT, () => {
  console.log(`Kitchen Queue HTTP server running on port ${HTTP_PORT}`);
});

// Start the worker
startWorker();
