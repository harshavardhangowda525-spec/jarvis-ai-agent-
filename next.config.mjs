// EV's motion graphics are drawn in a helper process (scripts/motion-render.mjs) — ship it and what it loads
const MOTION = ["./scripts/motion-render.mjs", "./src/lib/ev/motion/sandbox-core.mjs", "./node_modules/@resvg/**"];

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
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "satori", "@resvg/resvg-js", "playwright-core"],
    // EV renders its daily Reel with ffmpeg + the bundled Inter font — ship both
    // with the functions that render.
    outputFileTracingIncludes: {
      "/api/ev/daily": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**", ...MOTION],
      "/api/cron/ev-daily": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**", ...MOTION],
      // EV's motion graphics (ev_image / ev_video in a chat): the render helper process
      "/api/agent": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**", ...MOTION],
      // ROBIN draws quotation PDFs with the same font (it has the ₹ sign)
      "/api/robin/quotations/[id]": ["./assets/fonts/**"],
      "/api/robin/quotations/[id]/pdf": ["./assets/fonts/**"],
      // the database self-repair compares the real tables with these (src/lib/schema)
      "/api/**": ["./prisma/migrations/**"],
      "/dashboard/**": ["./prisma/migrations/**"],
    },
  },
  async headers() {
    return [
      // ASTON's previews (/p/…) set their own framing rules: JARVIS shows them
      // in its walkthrough frame (same site only); everything else is never framed.
      { source: "/((?!p/|s/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "microphone=(self), camera=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
