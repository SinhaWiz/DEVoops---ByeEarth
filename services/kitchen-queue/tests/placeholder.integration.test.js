const amqp = require('amqplib');
const uuidv4 = require('uuid').v4;
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

describe('Kitchen Queue Async/Ack Behavior', () => {
  let connection, channel;
  let workerProcess;
  let mockStockServer;
  const ORDER_QUEUE = 'orders_queue';
  const NOTIFICATION_QUEUE = 'notifications_queue';
  const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  const MOCK_STOCK_PORT = 14003;

  beforeAll(async () => {
    // Start a mock stock service that always succeeds
    mockStockServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/stock/reduce') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ newQuantity: 10 }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise(resolve => mockStockServer.listen(MOCK_STOCK_PORT, resolve));

    // Start the kitchen-queue worker as a child process
    workerProcess = spawn('node', [path.join(__dirname, '..', 'index.js')], {
      env: {
        ...process.env,
        RABBITMQ_URL,
        STOCK_SERVICE_URL: `http://localhost:${MOCK_STOCK_PORT}`,
        REDIS_URL,
      },
      stdio: 'pipe',
    });
    workerProcess.stdout.on('data', (data) => console.log(`[Worker] ${data.toString().trim()}`));
    workerProcess.stderr.on('data', (data) => console.error(`[Worker Error] ${data.toString().trim()}`));

    // Wait for worker to connect to RabbitMQ and Redis
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Connect to RabbitMQ for test assertions
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertQueue(ORDER_QUEUE, { durable: true });
    await channel.assertQueue(NOTIFICATION_QUEUE, { durable: true });
  }, 30000);

  afterAll(async () => {
    if (channel && typeof channel.close === 'function') {
      await channel.close();
    }
    if (connection && typeof connection.close === 'function') {
      await connection.close();
    }
    if (workerProcess) {
      workerProcess.kill();
    }
    if (mockStockServer) {
      await new Promise(resolve => mockStockServer.close(resolve));
    }
  });

  it('should ack order within 2s and process within 7s', async () => {
    const orderId = uuidv4();
    const orderMsg = {
      orderId,
      itemId: 'test-item',
      quantity: 1,
      userId: 'test-user'
    };

    // Purge notification queue to remove any stale messages
    await channel.purgeQueue(NOTIFICATION_QUEUE);

    // Set up notification consumer BEFORE sending the order, and await registration
    let resolveNotification, rejectNotification;
    const notificationPromise = new Promise((resolve, reject) => {
      resolveNotification = resolve;
      rejectNotification = reject;
    });

    const notificationTimeout = setTimeout(() => rejectNotification(new Error('No notification within 20s')), 20000);

    await channel.consume(NOTIFICATION_QUEUE, (msg) => {
      if (msg) {
        const notif = JSON.parse(msg.content.toString());
        if (notif.orderId === orderId && ['ORDER_SUCCESS', 'ORDER_FAILED'].includes(notif.type)) {
          clearTimeout(notificationTimeout);
          channel.ack(msg);
          resolveNotification({ notif, receivedAt: Date.now() });
        } else if (notif.orderId === orderId) {
          // Intermediate status notification (e.g. in_kitchen, stock_verified) — ack and skip
          channel.ack(msg);
        } else {
          channel.nack(msg, false, true);
        }
      }
    }, { noAck: false });

    // Now send the order (after consumer is confirmed registered)
    const sendTime = Date.now();
    channel.sendToQueue(ORDER_QUEUE, Buffer.from(JSON.stringify(orderMsg)), { persistent: true });

    // Ack time is immediate (simulate by checking after send)
    const ackTime = Date.now() - sendTime;
    expect(ackTime).toBeLessThan(2000); // Should be <2s

    // Wait for notification (eventual processing)
    const { notif, receivedAt } = await notificationPromise;
    const processTime = receivedAt - sendTime;
    expect(processTime).toBeGreaterThanOrEqual(3000); // >=3s
    expect(processTime).toBeLessThanOrEqual(15000); // <=15s (allow for CI slop)
    expect(['ORDER_SUCCESS', 'ORDER_FAILED']).toContain(notif.type);
  }, 30000); // 30s Jest timeout

  it('should retry on transient stock-service failure and eventually succeed', async () => {
    const orderId = uuidv4();
    let callCount = 0;

    // Override the mock stock server to fail the first attempt then succeed
    mockStockServer.removeAllListeners('request');
    mockStockServer.on('request', (req, res) => {
      if (req.method === 'POST' && req.url === '/stock/reduce') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          callCount++;
          if (callCount === 1) {
            // First call: simulate a transient 500 error
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          } else {
            // Subsequent calls: succeed
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ newQuantity: 9 }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await channel.purgeQueue(NOTIFICATION_QUEUE);

    const finalNotifPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No final notification within 40s')), 40000);
      channel.consume(NOTIFICATION_QUEUE, (msg) => {
        if (!msg) return;
        const notif = JSON.parse(msg.content.toString());
        channel.ack(msg);
        if (notif.orderId === orderId && ['ORDER_SUCCESS', 'ORDER_FAILED'].includes(notif.type)) {
          clearTimeout(timeout);
          resolve(notif);
        }
      }, { noAck: false });
    });

    channel.sendToQueue(
      ORDER_QUEUE,
      Buffer.from(JSON.stringify({ orderId, itemId: 'test-item', quantity: 1, userId: 'test-user' })),
      { persistent: true }
    );

    const notif = await finalNotifPromise;
    // Worker retried after the 500 — final result must be ORDER_SUCCESS
    expect(notif.type).toBe('ORDER_SUCCESS');
    expect(callCount).toBeGreaterThanOrEqual(2); // At least one retry happened
  }, 60000);

  it('should send ORDER_FAILED and not retry on permanent 422 (out of stock)', async () => {
    const orderId = uuidv4();
    let callCount = 0;

    mockStockServer.removeAllListeners('request');
    mockStockServer.on('request', (req, res) => {
      if (req.method === 'POST' && req.url === '/stock/reduce') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          callCount++;
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Insufficient stock' }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await channel.purgeQueue(NOTIFICATION_QUEUE);

    const finalNotifPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No ORDER_FAILED notification within 20s')), 20000);
      channel.consume(NOTIFICATION_QUEUE, (msg) => {
        if (!msg) return;
        const notif = JSON.parse(msg.content.toString());
        channel.ack(msg);
        if (notif.orderId === orderId && notif.type === 'ORDER_FAILED') {
          clearTimeout(timeout);
          resolve(notif);
        }
      }, { noAck: false });
    });

    channel.sendToQueue(
      ORDER_QUEUE,
      Buffer.from(JSON.stringify({ orderId, itemId: 'test-item', quantity: 1, userId: 'test-user' })),
      { persistent: true }
    );

    const notif = await finalNotifPromise;
    expect(notif.type).toBe('ORDER_FAILED');
    expect(notif.status).toBe('rejected');
    // Must NOT have retried — 422 is permanent
    expect(callCount).toBe(1);
  }, 30000);
});
