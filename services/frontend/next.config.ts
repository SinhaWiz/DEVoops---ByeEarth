import type { NextConfig } from "next";

// In docker-compose: env vars are not set, so the Docker-internal hostnames are
// used as fallbacks.  On Render: set each NEXT_PUBLIC_*_URL env var to the
// deployed Render service URL (e.g. https://byeearth-identity.onrender.com).
const IDP_URL       = process.env.IDENTITY_PROVIDER_URL       || 'http://identity-provider:3001';
const GATEWAY_URL   = process.env.ORDER_GATEWAY_URL           || 'http://order-gateway:3002';
const STOCK_URL     = process.env.STOCK_SERVICE_URL           || 'http://stock-service:3003';
const KITCHEN_URL   = process.env.KITCHEN_QUEUE_URL           || 'http://kitchen-queue:3004';
const NOTIF_URL     = process.env.NOTIFICATION_HUB_URL        || 'http://notification-hub:3005';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/api/identity-provider/:path*', destination: `${IDP_URL}/:path*` },
      { source: '/api/order-gateway/:path*',     destination: `${GATEWAY_URL}/:path*` },
      { source: '/api/stock-service/:path*',     destination: `${STOCK_URL}/:path*` },
      { source: '/api/kitchen-queue/:path*',     destination: `${KITCHEN_URL}/:path*` },
      { source: '/api/notification-hub/:path*',  destination: `${NOTIF_URL}/:path*` },
    ];
  },
};

export default nextConfig;
