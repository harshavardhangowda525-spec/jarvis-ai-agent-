import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/app-install/register-sw";

export const metadata: Metadata = {
  title: "JARVIS",
  description:
    "JARVIS — Just A Really Very Intelligent System. A general-purpose personal AI assistant with realtime voice, memory, and tools.",
  applicationName: "JARVIS",
  robots: { index: false, follow: false },
  // installable on phones: Android uses the web app manifest; iPhone uses these
  appleWebApp: { capable: true, title: "JARVIS", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/app/icon-192.png", sizes: "192x192" }], apple: [{ url: "/app/apple-touch-icon.png", sizes: "180x180" }] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#070b16",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="jarvis-bg antialiased">{children}<RegisterServiceWorker /></body>
    </html>
  );
}
