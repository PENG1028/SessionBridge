import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // Required for static export with dynamic routes
  trailingSlash: true,
};

export default nextConfig;
