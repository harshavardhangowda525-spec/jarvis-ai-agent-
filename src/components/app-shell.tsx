"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Terminal,
  Bot,
  ListChecks,
  Server,
  FolderOpen,
  Database,
  CalendarDays,
  Share2,
  Settings,
  StickyNote,
  Brain,
  LogOut,
  Maximize2,
  MousePointerClick,
  Code2,
  Radar,
  CandlestickChart, Handshake,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactorLogo, RobotFace, Chevrons, Waveform } from "@/components/hud/visuals";
import { useClock } from "@/hooks/useDeviceMetrics";
import { GestureProvider, useGesture } from "@/components/gesture/gesture-provider";
import { Hand, VolumeX } from "lucide-react";
import { isVoiceSilent, onVoiceSilent, setVoiceSilent } from "@/lib/voice/silence";

// Full mission-control nav. Every item routes to a real page (several are
// conceptual aliases of the same working page — e.g. Command Center is the
// console) so nothing 404s.
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard", label: "Command Center", icon: Terminal },
  { href: "/dashboard/operator", label: "Operator", icon: MousePointerClick },
  { href: "/dashboard/ultron", label: "ULTRON", icon: Code2 },
  { href: "/dashboard/darwin", label: "DARWIN", icon: Radar },
  { href: "/dashboard/mike", label: "MIKE", icon: CandlestickChart },
  { href: "/dashboard/rubin", label: "RUBIN", icon: Handshake },
  { href: "/dashboard/memory", label: "AI Agents", icon: Bot },
  { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks },
  { href: "/dashboard/settings", label: "Systems", icon: Server },
  { href: "/dashboard/notes", label: "Files", icon: FolderOpen },
  { href: "/dashboard/memory", label: "Database", icon: Database },
  { href: "/dashboard/tasks", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/settings", label: "Network", icon: Share2 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

// Compact nav for the mobile bottom bar (real, distinct pages only).
const MOBILE_NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks },
  { href: "/dashboard/notes", label: "Notes", icon: StickyNote },
  { href: "/dashboard/memory", label: "Memory", icon: Brain },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  user,
  children,
}: {
  user: { email: string; displayName: string | null; assistantName: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [online, setOnline] = useState<number | null>(null);
  const [build, setBuild] = useState<{ shortSha: string; env: string } | null>(null);
  const now = useClock();
  // The clock is client-only: the server's time (and timezone) never matches the browser's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // JARVIS, DARWIN and ULTRON are full-immersion screens — the nav rails fold
  // away so the cinematic interface owns the whole viewport (JARVIS has its own
  // systems menu).
  const immersive = pathname === "/dashboard" || pathname.startsWith("/dashboard/darwin") || pathname.startsWith("/dashboard/ultron") || pathname.startsWith("/dashboard/mike") || pathname.startsWith("/dashboard/rubin");

  const name = user.displayName || user.email.split("@")[0];

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.data?.services) return;
        const svc = j.data.services as Record<string, boolean>;
        const vals = Object.values(svc);
        setOnline(Math.round((vals.filter(Boolean).length / vals.length) * 100));
      })
      .catch(() => setOnline(null));
    // Which commit is live — confirms a deploy picked up the latest code.
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && setBuild({ shortSha: j.data.shortSha, env: j.data.env }))
      .catch(() => setBuild(null));
  }, []);

  // RUBIN's reminder emails: while JARVIS is open anywhere, check every 2 minutes
  // (each follow-up/demo is emailed once; the server decides what's due)
  useEffect(() => {
    const check = () => { void fetch("/api/robin/reminders", { method: "POST" }).catch(() => {}); };
    const first = setTimeout(check, 20_000);
    const iv = setInterval(check, 2 * 60_000);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  // Only the first nav item for a given href is "active-eligible", so duplicate
  // aliases (Dashboard/Command Center) never both light up.
  const primaryIndexForHref = new Map<string, number>();
  NAV.forEach((n, i) => { if (!primaryIndexForHref.has(n.href)) primaryIndexForHref.set(n.href, i); });
  const matchesPath = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  const isActive = (href: string) => href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  const weekday = mounted ? now.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase() : "";
  const date = mounted ? now
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase() : "";
  const time = mounted ? now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }) : "";

  return (
    <GestureProvider>
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="relative flex h-16 shrink-0 items-center gap-4 border-b border-accent/15 px-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="leading-none">
            <span className="hud-display text-2xl text-foreground text-glow sm:text-3xl">JARVIS</span>
            <span className="mt-0.5 hidden text-[8px] uppercase tracking-[0.28em] text-muted-foreground sm:block">
              Just a rather very intelligent system
            </span>
          </div>
        </Link>

        {/* center: SYSTEM ONLINE */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 md:flex">
          <Chevrons />
          <span className="hud-label text-[11px] text-accent-bright text-glow">System Online</span>
          <Chevrons dir="left" />
        </div>

        {/* right: clock + reactor + user */}
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right leading-tight sm:block">
            <div className="hud-label text-[9px] text-muted-foreground">{weekday}</div>
            <div className="flex items-baseline justify-end gap-2">
              <span className="hud-label text-[10px] text-accent">{date}</span>
              <span className="hud-display text-lg text-foreground text-glow tabular-nums">{time}</span>
            </div>
          </div>
          <ReactorLogo size={44} className="hidden sm:block" />
          <GestureToggle />
          <button
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            className="hidden h-9 w-9 items-center justify-center rounded text-muted-foreground transition hover:bg-accent/10 hover:text-accent lg:flex"
            aria-label="Fullscreen"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 rounded border border-accent/20 px-2.5 py-1.5 box-glow-soft">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-accent/15 text-xs font-semibold text-accent">
              {name[0]?.toUpperCase()}
            </span>
            <span className="hidden text-sm text-foreground/90 md:block">{name}</span>
            <button onClick={logout} aria-label="Log out" title="Log out">
              <LogOut className="h-4 w-4 text-muted-foreground transition hover:text-destructive" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left nav rail — desktop (folded away in immersive DARWIN mode) */}
        {!immersive && (
        <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-accent/15 p-3 md:flex">
          {/* robot face */}
          <div className="mb-3 flex justify-center pt-1">
            <RobotFace size={84} />
          </div>

          <nav className="flex flex-col gap-1">
            {NAV.map(({ href, label, icon: Icon }, i) => {
              const activeItem = matchesPath(href) && primaryIndexForHref.get(href) === i;
              return (
                <Link
                  key={label}
                  href={href}
                  className={cn(
                    "group relative flex items-center gap-3 overflow-hidden rounded px-3 py-2 text-sm transition",
                    activeItem
                      ? "bg-accent/12 text-accent-bright box-glow-soft"
                      : "text-muted-foreground hover:bg-accent/[0.07] hover:text-foreground",
                  )}
                >
                  {activeItem && <span className="absolute inset-y-1 left-0 w-[3px] bg-accent-bright shadow-[0_0_10px_hsl(var(--accent))]" />}
                  <Icon className={cn("h-4 w-4 transition", activeItem && "drop-glow")} />
                  <span className="hud-label text-[11px]">{label}</span>
                </Link>
              );
            })}
          </nav>

          {/* version + status block */}
          <div className="mt-4 rounded border border-accent/15 p-3 box-glow-soft">
            <div className="hud-label text-[11px] text-accent-bright">JARVIS v2.0.1</div>
            <div className="hud-label mt-0.5 text-[8px] text-muted-foreground">Premium AI Assistant</div>
            {build && (
              <div className="mt-1 font-mono text-[9px] text-muted-foreground" title="Live build (git commit)">
                build <span className="text-accent">{build.shortSha}</span>{build.env && build.env !== "production" ? ` · ${build.env}` : ""}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <span className="hud-label text-[8px] text-muted-foreground">Status</span>
              <span className="h-1.5 w-1.5 animate-hud-pulse rounded-full bg-success shadow-[0_0_8px_hsl(var(--success))]" />
              <span className="hud-label text-[9px] text-success">
                {online === null ? "Online" : `Online · ${online}%`}
              </span>
            </div>
            <div className="mt-2 h-6">
              <Waveform bars={26} active className="opacity-70" />
            </div>
          </div>
        </aside>
        )}

        {/* Content */}
        <main className={cn("min-w-0 flex-1", immersive ? "pb-0" : "pb-16 md:pb-0")}>{children}</main>
      </div>

      {/* Bottom nav — mobile (hidden in immersive DARWIN mode) */}
      <nav className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-accent/20 bg-panel/95 backdrop-blur md:hidden",
        immersive && "hidden",
      )}>
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={label}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[9px] uppercase tracking-wider",
              isActive(href) ? "text-accent-bright" : "text-muted-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
      <MutedPill />
    </div>
    </GestureProvider>
  );
}

/** Header switch for gesture mode (the camera only opens while it's on). */
function GestureToggle() {
  const g = useGesture();
  if (!g) return null;
  const on = g.status !== "off";
  return (
    <button
      onClick={() => (on ? g.disable() : void g.enable())}
      data-gesture-toggle
      aria-pressed={on}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded transition",
        on ? "bg-accent/15 text-accent-bright box-glow-soft" : "text-muted-foreground hover:bg-accent/10 hover:text-accent",
      )}
      aria-label={on ? "Turn gesture mode off" : "Turn gesture mode on"}
      title={on ? "Gesture mode is on — click to turn it off and release the camera" : "Gesture mode — control JARVIS with your hand (camera opens only while it's on)"}
    >
      <Hand className="h-4 w-4" />
    </button>
  );
}

/** While muted, every agent shows this: nothing is listening or talking. A click turns the mic and voice back on. */
function MutedPill() {
  const [silent, setSilent] = useState(false);
  useEffect(() => { setSilent(isVoiceSilent()); return onVoiceSilent(setSilent); }, []);
  if (!silent) return null;
  return (
    <button
      type="button" onClick={() => setVoiceSilent(false)} data-voice-muted
      title="Muted — the microphone is off. Click to turn it back on."
      className="fixed bottom-20 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-200/30 bg-slate-950/80 px-3.5 py-1.5 text-[10.5px] tracking-[0.16em] text-amber-100 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.8)] backdrop-blur-md transition hover:border-amber-200/60 md:bottom-5"
    >
      <VolumeX className="h-3.5 w-3.5" /> MUTED <span className="normal-case tracking-normal text-amber-100/60">— not listening · click to unmute</span>
    </button>
  );
}
