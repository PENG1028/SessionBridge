import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  ...(process.env.BRIDGE_EXPORT === '1' ? { output: 'export' as const } : {}),
  images: { unoptimized: true },
  // Required for static export with dynamic routes
  trailingSlash: true,
};

export default nextConfig;
