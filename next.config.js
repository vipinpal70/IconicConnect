/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
      },
    ],
  },
  async headers() {
    // Baseline security headers for every page/route EXCEPT the user-file proxy, which sets its own
    // stricter per-response headers (CSP sandbox, nosniff, forced download).
    const securityHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      // A safe CSP subset that does not constrain Next's inline scripts/styles: no plugins, no <base>
      // hijacking, forms may only post back to this origin, framing only by this origin.
      { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" },
    ];
    return [
      {
        source: '/((?!api/cases/files).*)',
        headers: securityHeaders,
      },
      {
        source: '/:all*(svg|png|jpg|jpeg|webp|gif|ico|woff|woff2|ttf|otf|mp4|webm)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, must-revalidate',
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        'ioredis': 'commonjs ioredis',
        'bullmq': 'commonjs bullmq',
      });
    }
    return config;
  },
  turbopack: {},
  experimental: {
    proxyClientMaxBodySize: '3gb',
  }
};

module.exports = nextConfig;
