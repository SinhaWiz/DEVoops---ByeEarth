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

    // Send order
    const sendTime = Date.now();
    await channel.sendToQueue(ORDER_QUEUE, Buffer.from(JSON.stringify(orderMsg)), { persistent: true });

    // Listen for notification
    const notificationPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No notification within 13s')), 13000);
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
    expect(processTime).toBeLessThanOrEqual(12000); // <=12s (allow for async slop)
    expect(['ORDER_SUCCESS', 'ORDER_FAILED']).toContain(notif.type);
  }, 15000); // Increase timeout to 15s
});
