import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        'ioredis': 'commonjs ioredis',
        'bullmq': 'commonjs bullmq',
      });
    }
    return config;
  },
};

export default nextConfig;
