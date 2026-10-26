/** Small custom SVG glyphs for each agent's identity (no icon library). */
export function AgentGlyph({ motif, size = 22, color = "currentColor" }: { motif: string; size?: number; color?: string }) {
  const s = { width: size, height: size, fill: "none", stroke: color, strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (motif) {
    case "scan": return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" opacity=".6" /><path d="M12 12 L19 7" /><path d="M3 12h2M19 12h2M12 3v2M12 19v2" opacity=".6" /></svg>;
    case "pulse": return <svg viewBox="0 0 24 24" {...s}><path d="M3 12h4l2-5 3 10 2-5h7" /><path d="M5 6h4M15 18h4" opacity=".5" /></svg>;
    case "wave": return <svg viewBox="0 0 24 24" {...s}><path d="M2 14c2.5 0 2.5-6 5-6s2.5 8 5 8 2.5-10 5-10 2.5 8 5 8" /><path d="M2 19h20" opacity=".4" /></svg>;
    case "geometry": return <svg viewBox="0 0 24 24" {...s}><path d="M12 3 21 8v8l-9 5-9-5V8z" /><path d="M12 3v18M3 8l18 8M21 8 3 16" opacity=".45" /></svg>;
    case "mesh": return <svg viewBox="0 0 24 24" {...s}><ellipse cx="12" cy="12" rx="9" ry="9" /><ellipse cx="12" cy="12" rx="4" ry="9" opacity=".6" /><path d="M3 12h18M5 7h14M5 17h14" opacity=".45" /></svg>;
    case "chart": return <svg viewBox="0 0 24 24" {...s}><path d="M3 20h18" opacity=".5" /><path d="M5 16l4-5 3 3 6-8" /><path d="M16 6h2v2" /></svg>;
    case "outline": return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="8" width="18" height="8" rx="4" /><path d="M7 12h6" opacity=".6" /></svg>;
    default: return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="6" /></svg>;
  }
}
