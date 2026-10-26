/** Shown while a dashboard page loads — the OMEGA "Loading…" screen. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" style={{ minHeight: "calc(100dvh - 3.5rem)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, background: "radial-gradient(900px 500px at 50% 40%, rgba(40,80,170,.2), transparent 70%), linear-gradient(180deg,#040b17,#02050b)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .om-load{width:46px;height:46px;border-radius:50%;border:2px solid rgba(120,200,255,.14);border-top-color:#5fe1ff;border-right-color:#9b7bff;animation:om-spin 1s linear infinite;box-shadow:0 0 24px rgba(95,225,255,.25)}
        @keyframes om-spin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion:reduce){.om-load{animation:none}}
      ` }} />
      <div className="om-load" />
      <span style={{ font: '500 12px "Barlow Condensed", Barlow, sans-serif', letterSpacing: ".4em", color: "#9fb7d0" }}>LOADING…</span>
    </div>
  );
}
