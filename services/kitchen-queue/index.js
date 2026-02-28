require('dotenv').config();

const amqp = require('amqplib');
const axios = require('axios');
const { createClient } = require('redis');


const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const STOCK_SERVICE_URL = process.env.STOCK_SERVICE_URL || 'http://stock-service:3003';
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
              // Notify User of Success
              const successNotification = {
                userId,
                orderId,
                type: 'ORDER_SUCCESS',
                message: `Your order for ${itemId} has been confirmed. Remaining stock: ${response.data.newQuantity}`,
                status: 'confirmed'
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
                channel.sendToQueue(ORDER_QUEUE, Buffer.from(JSON.stringify(orderData)), { persistent: true });
              } else {
                // Server error - retry (requeue by sending to ORDER_QUEUE again)
                channel.sendToQueue(ORDER_QUEUE, Buffer.from(JSON.stringify(orderData)), { persistent: true });
              }
            } else {
              console.error(`[Network Error] Could not reach Stock Service: ${err.message}`);
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

// Start the worker
startWorker();
