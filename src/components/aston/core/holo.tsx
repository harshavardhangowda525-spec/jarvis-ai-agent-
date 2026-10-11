"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Activity, Bell, Cpu, Globe, MessageSquare, Mic, ScrollText, SlidersHorizontal, Stethoscope, X, type LucideIcon } from "lucide-react";

export type WindowId = "alerts" | "ai" | "voice" | "conversation" | "activity" | "diagnostics" | "preferences";
export type MenuId = WindowId | "websites" | "scripts";

export const MENU: { id: MenuId; label: string; icon: LucideIcon }[] = [
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "ai", label: "AI status", icon: Cpu },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "conversation", label: "Conversation", icon: MessageSquare },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "websites", label: "Websites", icon: Globe },
  { id: "scripts", label: "Scripts", icon: ScrollText },
  { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
];

/**
 * The radial command menu: discreet glass controls that fan out around the
 * core. Positions come from the core's geometry so they ring it on any screen.
 */
export function RadialMenu({ open, cx, cy, radius, badges, onPick, onClose }: {
  open: boolean; cx: number; cy: number; radius: number;
  badges: Partial<Record<MenuId, number>>;
  onPick: (id: MenuId) => void; onClose: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) first.current?.focus(); }, [open]);
  if (!open) return null;
  const n = MENU.length;
  return (
    <div className="ax-radial" role="menu" aria-label="ASTON systems" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <button className="ax-radial-scrim" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      {MENU.map((m, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius;
        const Icon = m.icon;
        const badge = badges[m.id];
        return (
          <button
            key={m.id}
            ref={i === 0 ? first : undefined}
            role="menuitem"
            className="ax-node"
            style={{ left: x, top: y, ["--dx" as string]: `${cx - x}px`, ["--dy" as string]: `${cy - y}px`, animationDelay: `${i * 28}ms` }}
            onClick={() => onPick(m.id)}
          >
            <span className="ax-node-dot"><Icon size={18} strokeWidth={1.6} aria-hidden />{badge ? <b className="ax-badge">{badge}</b> : null}</span>
            <span className="ax-node-label">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A holographic window: unfolds out of the core (CSS transform-origin is set
 * to the core's position), dismissible with ×, Escape or a tap outside.
 * Beside the core on wide screens, a sheet over the lower screen on phones.
 */
export function HoloWindow({ title, sub, origin, onClose, children, wide = false }: {
  title: string; sub?: string; origin: { x: number; y: number }; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    prev.current = document.activeElement;
    ref.current?.focus();
    return () => { (prev.current as HTMLElement | null)?.focus?.(); };
  }, []);
  // before the first paint, so the unfold starts at the core
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsets ignore the (animating) transform; the layer is fixed at the viewport origin
    el.style.transformOrigin = `${origin.x - el.offsetLeft}px ${origin.y - el.offsetTop}px`;
  }, [origin.x, origin.y]);
  return (
    <div className="ax-win-layer" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <button className="ax-win-scrim" aria-label="Close window" tabIndex={-1} onClick={onClose} />
      <section ref={ref} tabIndex={-1} role="dialog" aria-modal="false" aria-label={title} className={`ax-win${wide ? " ax-win-wide" : ""}`}>
        <header className="ax-win-head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button className="ax-icon-btn" onClick={onClose} aria-label={`Close ${title}`}><X size={16} aria-hidden /></button>
        </header>
        <div className="ax-win-body">{children}</div>
      </section>
    </div>
  );
}

export function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: "ok" | "warn" | "bad" | "dim" }) {
  return (
    <div className="ax-row">
      <span>{k}</span>
      <b className={tone ? `ax-${tone}` : undefined}>{v}</b>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="ax-empty">{children}</p>;
}
