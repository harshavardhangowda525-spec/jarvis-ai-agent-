"use client";

/**
 * The hand-off from JARVIS to MIKE: an iris of MIKE's dark trading floor opens
 * from the centre with a cyan shock ring and light streaks rushing in, the
 * wordmark resolves, and MIKE's own boot sequence picks up from there.
 */
export function MikeLaunchOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[200]" aria-hidden>
      <div className="mike-iris mike-bg absolute inset-0">
        <div className="mike-grid absolute inset-0" />
        {Array.from({ length: 14 }, (_, i) => (
          <span
            key={i}
            className="mike-streak absolute h-px bg-gradient-to-r from-transparent via-cyan-200 to-transparent"
            style={{ top: `${8 + ((i * 53) % 84)}%`, width: `${18 + ((i * 37) % 22)}%`, left: i % 2 ? "auto" : "-30%", right: i % 2 ? "-30%" : "auto", animationDelay: `${0.1 + (i % 7) * 0.05}s`, ["--dir" as string]: i % 2 ? "-1" : "1" }}
          />
        ))}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="flex gap-[0.35em] text-6xl font-bold text-white sm:text-8xl" style={{ textShadow: "0 0 34px rgba(34,211,238,.8)" }}>
            {"MIKE".split("").map((ch, i) => <span key={i} className="mike-letter inline-block" style={{ animationDelay: `${0.25 + i * 0.08}s` }}>{ch}</span>)}
          </div>
          <div className="mike-typein mt-3 overflow-hidden whitespace-nowrap font-mono text-xs tracking-[0.4em] text-cyan-300/80" style={{ animationDelay: "0.55s" }}>ACTIVATING MARKET INTELLIGENCE</div>
        </div>
      </div>
      <div className="mike-shock absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300/80 shadow-[0_0_40px_rgba(34,211,238,0.8)]" />
    </div>
  );
}
