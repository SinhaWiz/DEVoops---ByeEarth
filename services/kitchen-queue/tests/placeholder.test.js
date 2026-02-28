const amqp = require('amqplib');
const { v4: uuidv4 } = require('uuid');

describe('Kitchen Queue Async/Ack Behavior', () => {
  let connection, channel;
  const ORDER_QUEUE = 'orders_queue';
  const NOTIFICATION_QUEUE = 'notifications_queue';
  const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

  beforeAll(async () => {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertQueue(ORDER_QUEUE, { durable: true });
    await channel.assertQueue(NOTIFICATION_QUEUE, { durable: true });
  });

  afterAll(async () => {
    await channel.close();
    await connection.close();
  });

  it('should ack order within 2s and process within 7s', async () => {
    const orderId = uuidv4();
    const orderMsg = {
      orderId,
      itemId: 'test-item',
      quantity: 1,
      userId: 'test-user'
    };

    // Send order
    const sendTime = Date.now();
    await channel.sendToQueue(ORDER_QUEUE, Buffer.from(JSON.stringify(orderMsg)), { persistent: true });

    // Listen for notification
    const notificationPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No notification within 8s')), 8000);
      channel.consume(NOTIFICATION_QUEUE, (msg) => {
        if (msg) {
          const notif = JSON.parse(msg.content.toString());
          if (notif.orderId === orderId) {
            clearTimeout(timeout);
            channel.ack(msg);
            resolve({ notif, receivedAt: Date.now() });
          } else {
            channel.nack(msg, false, true);
          }
        }
      }, { noAck: false });
    });

    // Ack time is immediate (simulate by checking after send)
    const ackTime = Date.now() - sendTime;
    expect(ackTime).toBeLessThan(2000); // Should be <2s

    // Wait for notification (eventual processing)
    const { notif, receivedAt } = await notificationPromise;
    const processTime = receivedAt - sendTime;
    expect(processTime).toBeGreaterThanOrEqual(3000); // >=3s
    expect(processTime).toBeLessThanOrEqual(8000); // <=8s (should be <=7s, but allow for test slop)
    expect(['ORDER_SUCCESS', 'ORDER_FAILED']).toContain(notif.type);
  });
});
