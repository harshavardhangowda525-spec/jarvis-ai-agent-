import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JARVIS AI",
  description:
    "JARVIS — a general-purpose personal AI assistant with realtime voice, memory, and tools.",
  applicationName: "JARVIS AI",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#050a14",
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
      <body className="jarvis-bg font-sans antialiased">{children}</body>
    </html>
  );
}
