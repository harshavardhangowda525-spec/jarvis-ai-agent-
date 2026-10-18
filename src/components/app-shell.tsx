"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ListChecks,
  Settings,
  StickyNote,
  Brain,
  LogOut,
  Lock,
  Maximize2, Handshake,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactorLogo, Chevrons } from "@/components/hud/visuals";
import { useClock } from "@/hooks/useDeviceMetrics";
import { GestureProvider, useGesture } from "@/components/gesture/gesture-provider";
import { Hand, VolumeX } from "lucide-react";
import { isVoiceSilent, onVoiceSilent, setVoiceSilent } from "@/lib/voice/silence";
import { useMutedWake } from "@/hooks/useMutedWake";

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
  const now = useClock();
  // The clock is client-only: the server's time (and timezone) never matches the browser's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // JARVIS, ULTRON and the agent chats are full-immersion screens: no bottom bar on
  // phones either. (There's no side bar anywhere — JARVIS's Systems menu has every page.)
  const immersive = pathname === "/dashboard" || pathname.startsWith("/dashboard/chat") || pathname.startsWith("/dashboard/ultron");

  const name = user.displayName || user.email.split("@")[0];

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

  // Lock: stay signed in, but the biometric gate asks again
  async function lock() {
    await fetch("/api/gate/lock", { method: "POST" }).catch(() => {});
    router.replace(`/unlock?next=${encodeURIComponent(location.pathname + location.search)}`);
  }

  // The unlock ran out (12 h) while JARVIS was open: every API answers 423 →
  // go to the gate instead of failing quietly.
  useEffect(() => {
    const orig = window.fetch;
    let sent = false;
    window.fetch = async (...args) => {
      const res = await orig(...args);
      if (res.status === 423 && res.headers.get("x-jarvis-locked") === "1" && !sent) {
        sent = true;
        router.replace(`/unlock?next=${encodeURIComponent(location.pathname + location.search)}`);
      }
      return res;
    };
    return () => { window.fetch = orig; };
  }, [router]);

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
            <button onClick={lock} aria-label="Lock JARVIS" title="Lock JARVIS (face unlock to return)">
              <Lock className="h-4 w-4 text-muted-foreground transition hover:text-accent" />
            </button>
            <button onClick={logout} aria-label="Log out" title="Log out">
              <LogOut className="h-4 w-4 text-muted-foreground transition hover:text-destructive" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
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

/** While muted, every agent shows this: nothing is heard but "Hey JARVIS". Saying it, or a click, turns the mic and voice back on. */
function MutedPill() {
  const [silent, setSilent] = useState(false);
  const wakeReady = useMutedWake();
  useEffect(() => { setSilent(isVoiceSilent()); return onVoiceSilent(setSilent); }, []);
  if (!silent) return null;
  return (
    <button
      type="button" onClick={() => setVoiceSilent(false)} data-voice-muted
      title={wakeReady ? "Muted — only listening for “Hey JARVIS”. Say it, or click, to unmute." : "Muted — the microphone is off. Click to turn it back on."}
      className="fixed bottom-20 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-200/30 bg-slate-950/80 px-3.5 py-1.5 text-[10.5px] tracking-[0.16em] text-amber-100 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.8)] backdrop-blur-md transition hover:border-amber-200/60 md:bottom-5"
    >
      <VolumeX className="h-3.5 w-3.5" /> MUTED <span className="normal-case tracking-normal text-amber-100/60">{wakeReady ? "— say “Hey JARVIS” or click to unmute" : "— not listening · click to unmute"}</span>
    </button>
  );
}
