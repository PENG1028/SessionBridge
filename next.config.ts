import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // output: 'export',  // 仅在 build 时启用；dev 时注释掉，否则 Turbo 不刷新
  images: { unoptimized: true },
  // Required for static export with dynamic routes
  trailingSlash: true,

  // Proxy /api/* to the relay server during dev.
  // In production (static export), the relay server serves the built files directly.
  async rewrites() {
    return [
      // Match with and without trailing slash (trailingSlash: true adds /)
      { source: '/api/:path*/', destination: 'http://localhost:8080/api/:path*' },
      { source: '/api/:path*',  destination: 'http://localhost:8080/api/:path*' },
    ];
  },
};

export default nextConfig;
