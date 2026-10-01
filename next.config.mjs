/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Inlined at build time so the gesture test hook is compiled out of normal builds.
  env: { NEXT_PUBLIC_GESTURE_TEST: process.env.NEXT_PUBLIC_GESTURE_TEST === "1" ? "1" : "" },
  eslint: {
    // Lint is run explicitly in CI via `npm run lint`; don't fail production builds on it.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // satori + resvg draw the Reel's text overlays (resvg is a native module — never bundled)
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "satori", "@resvg/resvg-js"],
    // EV renders its daily Reel with ffmpeg + the bundled Inter font — ship both
    // with the functions that render.
    outputFileTracingIncludes: {
      "/api/ev/daily": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/cron/ev-daily": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      // ROBIN draws quotation PDFs with the same font (it has the ₹ sign)
      "/api/robin/quotations/[id]": ["./assets/fonts/**"],
      "/api/robin/quotations/[id]/pdf": ["./assets/fonts/**"],
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
