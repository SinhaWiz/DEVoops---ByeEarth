require('dotenv').config();
const amqp = require('amqplib');
const axios = require('axios');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const STOCK_SERVICE_URL = process.env.STOCK_SERVICE_URL || 'http://stock-service:3003';
const QUEUE_NAME = 'orders_queue';

async function startWorker() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue(QUEUE_NAME, { durable: true });
    channel.prefetch(1); // Process one message at a time

    console.log(`Kitchen Queue Worker started. Waiting for messages in ${QUEUE_NAME}...`);

    channel.consume(QUEUE_NAME, async (msg) => {
      if (msg !== null) {
        const orderData = JSON.parse(msg.content.toString());
        console.log(`[Queue] Processing Order: ${orderData.orderId} for Item: ${orderData.itemId}`);

        try {
          // 1. Call Stock Service to finalize reduction in Postgres (Source of Truth)
          const response = await axios.post(`${STOCK_SERVICE_URL}/stock/reduce`, {
            itemId: orderData.itemId,
            quantity: orderData.quantity
          });

          if (response.status === 200) {
            console.log(`[Success] Stock reduced for Order: ${orderData.orderId}. New stock: ${response.data.newQuantity}`);
            // Acknowledge message
            channel.ack(msg);
          } else {
            // This case might be covered by catch if status is 4xx/5xx
            console.error(`[Error] Unexpected response from Stock Service: ${response.status}`);
            // Logic for retry or DLQ (Dead Letter Queue) could go here
            // For now, we'll nack and requeue
            channel.nack(msg, false, true);
          }

        } catch (err) {
          if (err.response) {
            const status = err.response.status;
            const errorMsg = err.response.data.error || err.message;

            console.error(`[Error] ${status} from Stock Service for Order ${orderData.orderId}: ${errorMsg}`);

            if (status === 422 || status === 404) {
              // Item not found or Insufficient stock - Cannot be fulfilled
              console.error(`[Critical] Order ${orderData.orderId} failed fulfillment: ${errorMsg}`);
              // Acknowledge so it's removed from queue (or move to failed_orders_queue)
              channel.ack(msg); 
            } else if (status === 409) {
              // Conflict (Optimistic Lock) - retry
              console.log(`[Retry] Conflict detected for ${orderData.orderId}. Re-queuing...`);
              channel.nack(msg, false, true);
            } else {
              // Server error - retry
              channel.nack(msg, false, true);
            }
          } else {
            console.error(`[Network Error] Could not reach Stock Service: ${err.message}`);
            channel.nack(msg, false, true);
          }
        }
      }
    });

  } catch (err) {
    console.error('Failed to start Kitchen Queue Worker:', err.message);
    setTimeout(startWorker, 5000); // Retry connection
  }
}

// Start the worker
startWorker();
