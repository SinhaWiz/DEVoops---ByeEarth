require('dotenv').config();
const amqp = require('amqplib');
const axios = require('axios');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const STOCK_SERVICE_URL = process.env.STOCK_SERVICE_URL || 'http://stock-service:3003';
const ORDER_QUEUE = 'orders_queue';
const NOTIFICATION_QUEUE = 'notifications_queue';

async function startWorker() {
  try {
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
        console.log(`[Queue] Processing Order: ${orderId} for Item: ${itemId}`);

        try {
          // 1. Call Stock Service to finalize reduction in Postgres (Source of Truth)
          const response = await axios.post(`${STOCK_SERVICE_URL}/stock/reduce`, {
            itemId: itemId,
            quantity: quantity
          });

          if (response.status === 200) {
            console.log(`[Success] Stock reduced for Order: ${orderId}. New stock: ${response.data.newQuantity}`);
            
            // 2. Notify User of Success
            const successNotification = {
              userId,
              orderId,
              type: 'ORDER_SUCCESS',
              message: `Your order for ${itemId} has been confirmed. Remaining stock: ${response.data.newQuantity}`,
              status: 'confirmed'
            };
            
            channel.sendToQueue(NOTIFICATION_QUEUE, Buffer.from(JSON.stringify(successNotification)), { persistent: true });
            
            channel.ack(msg);
          }

        } catch (err) {
          if (err.response) {
            const status = err.response.status;
            const errorMsg = err.response.data.error || err.message;
            console.error(`[Error] ${status} from Stock Service for Order ${orderId}: ${errorMsg}`);

            if (status === 422 || status === 404) {
              // Item not found or Insufficient stock - Cannot be fulfilled
              console.error(`[Critical] Order ${orderId} failed fulfillment: ${errorMsg}`);

              // Notify User of Failure
              const failureNotification = {
                userId,
                orderId,
                type: 'ORDER_FAILED',
                message: `Sorry, your order for ${itemId} failed: ${errorMsg}`,
                status: 'rejected'
              };
              channel.sendToQueue(NOTIFICATION_QUEUE, Buffer.from(JSON.stringify(failureNotification)), { persistent: true });

              channel.ack(msg); 
            } else if (status === 409) {
              // Conflict (Optimistic Lock) - retry
              console.log(`[Retry] Conflict detected for ${orderId}. Re-queuing...`);
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
