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
};

export default nextConfig;
