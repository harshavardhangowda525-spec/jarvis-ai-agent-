/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Lint is run explicitly in CI via `npm run lint`; don't fail production builds on it.
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
    // EV renders its daily Reel with ffmpeg + the bundled Inter font — ship both
    // with the functions that render.
    outputFileTracingIncludes: {
      "/api/ev/daily": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/cron/ev-daily": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "microphone=(self), camera=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
