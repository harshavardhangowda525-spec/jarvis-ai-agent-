"use client";

/**
 * The hand-off from JARVIS to ROBIN: concentric rings open out of the centre
 * like Robin's core powering up, the wordmark resolves, and Robin's command
 * center takes over.
 */
export function RobinLaunchOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[200]" aria-hidden>
      <div className="robin-iris robin-bg absolute inset-0">
        <div className="robin-grid absolute inset-0" />
        <div className="absolute inset-0 flex items-center justify-center">
          {[0, 1, 2, 3].map((i) => <span key={i} className="robin-launch-ring absolute rounded-full border border-cyan-200/50" style={{ width: 120 + i * 90, height: 120 + i * 90, animationDelay: `${0.1 + i * 0.12}s` }} />)}
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="flex gap-[0.3em] text-6xl font-light tracking-[0.2em] text-white sm:text-7xl" style={{ textShadow: "0 0 30px rgba(103,232,249,.7)" }}>
            {"ROBIN".split("").map((ch, i) => <span key={i} className="robin-letter inline-block" style={{ animationDelay: `${0.3 + i * 0.07}s` }}>{ch}</span>)}
          </div>
          <div className="robin-typein mt-3 overflow-hidden whitespace-nowrap text-[11px] tracking-[0.45em] text-cyan-200/80" style={{ animationDelay: "0.6s" }}>SALES INTELLIGENCE</div>
        </div>
      </div>
    </div>
  );
}
