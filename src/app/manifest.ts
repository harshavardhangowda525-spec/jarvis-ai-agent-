import type { MetadataRoute } from "next";

/**
 * JARVIS as an installable phone app (PWA): Android Chrome installs it as a
 * real app (home-screen icon, app drawer, full screen, no browser bar);
 * iPhone adds it from Safari's Share → Add to Home Screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "JARVIS",
    short_name: "JARVIS",
    description: "Your JARVIS assistant, DARWIN's CRM and the agents — on your phone.",
    start_url: "/dashboard?source=app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#070b16",
    theme_color: "#070b16",
    categories: ["business", "productivity"],
    icons: [
      { src: "/app/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "DARWIN CRM", short_name: "CRM", url: "/dashboard/crm", icons: [{ src: "/app/icon-192.png", sizes: "192x192" }] },
      { name: "Agent tasks", short_name: "Tasks", url: "/dashboard/jobs", icons: [{ src: "/app/icon-192.png", sizes: "192x192" }] },
      { name: "DARWIN chat", short_name: "DARWIN", url: "/dashboard/chat/darwin", icons: [{ src: "/app/icon-192.png", sizes: "192x192" }] },
      { name: "RUBIN chat", short_name: "RUBIN", url: "/dashboard/chat/robin", icons: [{ src: "/app/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
