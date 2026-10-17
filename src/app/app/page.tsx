import { headers } from "next/headers";
import QRCode from "qrcode";
import { InstallButton } from "@/components/app-install/install-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "JARVIS on your phone" };

/**
 * Get JARVIS on your phone. Open this page on your computer and scan the code
 * with the phone, or open it on the phone and tap Install.
 */
export default async function AppInstallPage() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const url = `${proto}://${host}/app`;
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(host);
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#0A2540", light: "#FFFFFF" }, errorCorrectionLevel: "M" });
  return (
    <main style={{ minHeight: "100dvh", background: "#070b16", color: "#e2e8f0", font: "15px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", display: "flex", justifyContent: "center", padding: "32px 16px" }}>
      <div style={{ width: "min(560px, 100%)", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/app/icon-192.png" alt="" width={64} height={64} style={{ borderRadius: 16 }} />
          <div><h1 style={{ margin: 0, fontSize: 22, letterSpacing: ".2em", fontWeight: 500 }}>JARVIS</h1><span style={{ color: "#94a3b8" }}>on your phone</span></div>
        </div>
        <InstallButton />
        <section style={{ background: "#0b1a2f", border: "1px solid #1e3a5f", borderRadius: 14, padding: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 150, height: 150, background: "#fff", borderRadius: 10, padding: 6 }} dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code for ${url}`} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <b>On your computer?</b> Scan this with your phone&apos;s camera to open this page there.
            <div style={{ marginTop: 6, color: "#7dd3fc", wordBreak: "break-all" }}>{url}</div>
            {local && <p style={{ color: "#fbbf24", margin: "8px 0 0" }}>This address only works on this computer&apos;s network. For JARVIS anywhere, open this page from your online JARVIS (your Vercel address).</p>}
          </div>
        </section>
        <section style={{ display: "grid", gap: 12 }}>
          <div style={{ background: "#0b1a2f", border: "1px solid #1e3a5f", borderRadius: 14, padding: 16 }}>
            <b>Android (Chrome)</b>
            <ol style={{ margin: "6px 0 0", paddingLeft: 20, color: "#cbd5e1" }}>
              <li>Open this page in <b>Chrome</b>.</li>
              <li>Tap <b>Install JARVIS</b> above — or Chrome&apos;s <b>⋮ menu → Install app</b> (or <b>Add to Home screen</b>).</li>
              <li>JARVIS appears in your app drawer and home screen and opens full screen.</li>
            </ol>
          </div>
          <div style={{ background: "#0b1a2f", border: "1px solid #1e3a5f", borderRadius: 14, padding: 16 }}>
            <b>iPhone (Safari)</b>
            <ol style={{ margin: "6px 0 0", paddingLeft: 20, color: "#cbd5e1" }}>
              <li>Open this page in <b>Safari</b>.</li>
              <li>Tap <b>Share</b> (the square with an arrow) → <b>Add to Home Screen</b> → <b>Add</b>.</li>
            </ol>
          </div>
          <p style={{ color: "#94a3b8", margin: 0 }}>
            Sign in once in the app. Allow the microphone when asked to talk to JARVIS. The app is your online JARVIS, so it works anywhere with internet — your PC doesn&apos;t need to be on (agents that run on the PC, like ULTRON and app control, still need it).
          </p>
          <a href="/dashboard" style={{ color: "#38bdf8" }}>Open JARVIS →</a>
        </section>
      </div>
    </main>
  );
}
