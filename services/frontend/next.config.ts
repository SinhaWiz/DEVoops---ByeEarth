import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/api/identity-provider/:path*', destination: 'http://identity-provider:3001/:path*' },
      { source: '/api/order-gateway/:path*', destination: 'http://order-gateway:3002/:path*' },
      { source: '/api/stock-service/:path*', destination: 'http://stock-service:3003/:path*' },
      { source: '/api/kitchen-queue/:path*', destination: 'http://kitchen-queue:3004/:path*' },
      { source: '/api/notification-hub/:path*', destination: 'http://notification-hub:3005/:path*' },
    ];
  },
};

export default nextConfig;
