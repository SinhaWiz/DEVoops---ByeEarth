require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const amqp = require('amqplib');
const cors = require('cors');
const promClient = require('prom-client');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3005;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const QUEUE_NAME = 'notifications_queue';

// Prometheus Metrics Setup
promClient.collectDefaultMetrics();

const notificationsPushedCounter = new promClient.Counter({
  name: 'notifications_pushed_total',
  help: 'Total number of notifications pushed to clients',
});

const socketConnectionsGauge = new promClient.Gauge({
  name: 'socket_connections_active',
  help: 'Number of active WebSocket connections',
});

app.use(cors());
app.use(express.json());

// Root route
app.get('/', (req, res) => {
  res.status(200).json({ service: 'notification-hub', status: 'UP', endpoints: ['/health', '/metrics'] });
});

// Health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: 'notification-hub' });
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

// Connection Handling
io.on('connection', (socket) => {
  console.log(`[Socket] New client connected: ${socket.id}`);
  socketConnectionsGauge.inc();

  socket.on('join_user', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`[Socket] Client ${socket.id} joined room for user_${userId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
    socketConnectionsGauge.dec();
  });
});

// RabbitMQ Notification Consumer
async function startNotificationConsumer() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue(QUEUE_NAME, { durable: true });
    console.log(`[Queue] Notification Hub listening on ${QUEUE_NAME}...`);

    channel.consume(QUEUE_NAME, (msg) => {
      if (msg !== null) {
        const notification = JSON.parse(msg.content.toString());
        const { userId, type, orderId, message, status } = notification;

        console.log(`[Push] Sending ${type} notification for order: ${orderId} to user: ${userId}`);

        // Emit specifically to the user's room
        io.to(`user_${userId}`).emit('notification', {
          orderId,
          type,
          message,
          status,
          timestamp: new Date().toISOString()
        });

        notificationsPushedCounter.inc();
        channel.ack(msg);
      }
    });

  } catch (err) {
    console.error('Failed to start notification consumer:', err.message);
    setTimeout(startNotificationConsumer, 5000);
  }
}

// Start Hub
async function init() {
  await startNotificationConsumer();
  server.listen(PORT, () => {
    console.log(`Notification Hub running on port ${PORT}`);
  });
}

init();
