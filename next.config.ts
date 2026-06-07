import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  ...(process.env.BRIDGE_EXPORT === '1' ? { output: 'export' as const, trailingSlash: true } : {}),
  images: { unoptimized: true },
  // Keep ws as Node.js runtime module — webpack bundling breaks Buffer/mask
  serverExternalPackages: ['ws'],
  // Allow imports from plugins/ directory outside app/
  experimental: {
    externalDir: true,
  },
  // Allow dev mode HMR WebSocket connections from LAN IPs (not just localhost).
  // v15.2.2+ added origin validation for CSRF; without this, non-localhost
  // access gets ERR_INVALID_HTTP_RESPONSE and React never hydrates.
  // Use ALLOWED_DEV_ORIGINS env var to customize (comma-separated), or defaults
  // to common LAN patterns so phone testing works out of the box.
  allowedDevOrigins: (
    process.env.ALLOWED_DEV_ORIGINS
      ? process.env.ALLOWED_DEV_ORIGINS.split(',').map(s => s.trim())
      : ['*.local', '192.168.*.*', '10.*.*.*', '172.16.*.*']
  ),
};

export default nextConfig;
