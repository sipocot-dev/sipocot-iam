import type { NextConfig } from 'next';

/**
 * Next.js config.
 * - `output: 'standalone'` produces a self-contained server for container / Kubernetes images.
 *   Vercel ignores it and uses its own build output, so one config serves both targets.
 * - Native / Node-only packages stay external so they are not bundled.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ['@node-rs/argon2', 'pino', 'pino-pretty', 'ioredis', 'postgres', 'prom-client'],
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]);
  },
};

export default nextConfig;
