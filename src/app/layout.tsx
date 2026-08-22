import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JARVIS",
  description:
    "JARVIS — Just A Really Very Intelligent System. A general-purpose personal AI assistant with realtime voice, memory, and tools.",
  applicationName: "JARVIS",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#070b16",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
      <body className="jarvis-bg antialiased">{children}</body>
    </html>
  );
}
