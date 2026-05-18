/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        'ioredis': 'commonjs ioredis',
        'bullmq': 'commonjs bullmq',
      });
    }
    return config;
  },
  turbopack: {}
};

module.exports = nextConfig;
