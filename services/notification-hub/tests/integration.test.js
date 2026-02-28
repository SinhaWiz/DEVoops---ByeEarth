/**
 * Integration tests for Notification Hub.
 * Run against the live docker-compose stack.
 * Requires: notification-hub (localhost:3005), RabbitMQ (localhost:5672)
 *
 * Tests:
 *  - Health endpoint
 *  - Socket.io connection and room joining
 *  - End-to-end: publish to RabbitMQ → receive via Socket.io
 */
const { io: ioClient } = require('socket.io-client');
const amqp = require('amqplib');
const axios = require('axios');

const HUB_URL = process.env.NOTIFICATION_HUB_URL || 'http://localhost:3005';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const NOTIFICATION_QUEUE = 'notifications_queue';

describe('Notification Hub - Integration Tests', () => {

  describe('GET /health', () => {
    it('should return 200 with status UP', async () => {
      const res = await axios.get(`${HUB_URL}/health`);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('UP');
      expect(res.data.service).toBe('notification-hub');
    });
  });

  describe('Socket.io connection', () => {
    let socket;

    afterEach(() => {
      if (socket && socket.connected) {
        socket.disconnect();
      }
    });

    it('should connect successfully', (done) => {
      socket = ioClient(HUB_URL, {
        transports: ['websocket'],
        reconnection: false,
      });

      socket.on('connect', () => {
        expect(socket.connected).toBe(true);
        done();
      });

      socket.on('connect_error', (err) => {
        done.fail(`Connection failed: ${err.message}`);
      });
    }, 10000);

    it('should allow joining a user room', (done) => {
      socket = ioClient(HUB_URL, {
        transports: ['websocket'],
        reconnection: false,
      });

      socket.on('connect', () => {
        // join_user should not throw; we just verify the socket stays connected
        socket.emit('join_user', 'test-user-room');
        // Give server a moment to process
        setTimeout(() => {
          expect(socket.connected).toBe(true);
          done();
        }, 500);
      });
    }, 10000);
  });

  describe('RabbitMQ → Socket.io notification delivery', () => {
    let socket;
    let mqConnection;
    let mqChannel;

    beforeAll(async () => {
      mqConnection = await amqp.connect(RABBITMQ_URL);
      mqChannel = await mqConnection.createChannel();
      await mqChannel.assertQueue(NOTIFICATION_QUEUE, { durable: true });
    });

    afterAll(async () => {
      if (socket && socket.connected) {
        socket.disconnect();
      }
      if (mqChannel) await mqChannel.close();
      if (mqConnection) await mqConnection.close();
    });

    it('should deliver a notification from RabbitMQ to the connected Socket.io client', (done) => {
      const testUserId = `integration-test-user-${Date.now()}`;
      const testOrderId = `ord-integration-${Date.now()}`;

      socket = ioClient(HUB_URL, {
        transports: ['websocket'],
        reconnection: false,
      });

      socket.on('connect', () => {
        // Join the user's room
        socket.emit('join_user', testUserId);

        // Wait for room join to propagate, then publish
        setTimeout(() => {
          const notification = {
            userId: testUserId,
            orderId: testOrderId,
            type: 'ORDER_SUCCESS',
            message: 'Integration test notification',
            status: 'confirmed',
          };
          mqChannel.sendToQueue(
            NOTIFICATION_QUEUE,
            Buffer.from(JSON.stringify(notification)),
            { persistent: true }
          );
        }, 1000);
      });

      // Listen for the notification event
      socket.on('notification', (data) => {
        try {
          expect(data.orderId).toBe(testOrderId);
          expect(data.type).toBe('ORDER_SUCCESS');
          expect(data.message).toBe('Integration test notification');
          expect(data.status).toBe('confirmed');
          expect(data).toHaveProperty('timestamp');
          done();
        } catch (err) {
          done.fail(err);
        }
      });

      // Timeout safety
      setTimeout(() => {
        done.fail('Notification not received within 10s');
      }, 10000);
    }, 15000);
  });
});
