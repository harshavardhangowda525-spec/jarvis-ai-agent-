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
  Maximize2, Bell, Radar, Network, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GestureProvider, useGesture } from "@/components/gesture/gesture-provider";
import { Hand, VolumeX } from "lucide-react";
import { isVoiceSilent, onVoiceSilent, setVoiceSilent } from "@/lib/voice/silence";
import { useMutedWake } from "@/hooks/useMutedWake";

// The OMEGA workspaces (top bar on desktop, bottom bar on phones).
const TABS = [
  { href: "/dashboard", label: "Home" },
  { href: "/dashboard/intel", label: "Business Intelligence" },
  { href: "/dashboard/nexus", label: "Agent Command Nexus" },
  { href: "/dashboard/activity", label: "Activity Center" },
];
const MOBILE_NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/dashboard/intel", label: "Intel", icon: Radar },
  { href: "/dashboard/nexus", label: "Nexus", icon: Network },
  { href: "/dashboard/activity", label: "Activity", icon: Inbox },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const BAR_CSS = `
html[data-home-view="omega"] .om-bar.is-home{display:none}
html[data-home-view="omega"] .jarvis-os{height:100dvh}
.om-bar{position:relative;z-index:40;display:flex;align-items:center;gap:18px;height:56px;flex-shrink:0;padding:0 18px;background:linear-gradient(180deg,rgba(6,14,28,.96),rgba(3,8,18,.92));border-bottom:1px solid rgba(120,200,255,.10);box-shadow:0 1px 0 rgba(95,225,255,.06),0 10px 30px rgba(0,0,0,.35)}
.om-bar::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,rgba(95,225,255,.45),rgba(155,123,255,.35),transparent)}
.om-bar-brand{font:500 19px "Barlow Condensed",Barlow,sans-serif;letter-spacing:.42em;color:#eef7ff;text-decoration:none;text-shadow:0 0 18px rgba(95,225,255,.35)}
.om-bar-tabs{display:flex;align-items:stretch;gap:4px;height:100%;margin-left:12px}
.om-bar-tabs a{position:relative;display:flex;align-items:center;padding:0 14px;font:500 11px "Barlow Condensed",Barlow,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#7f97b2;text-decoration:none;white-space:nowrap;transition:color .2s}
.om-bar-tabs a:hover{color:#dcecff}
.om-bar-tabs a.on{color:#f2f9ff}
.om-bar-tabs a.on::after{content:"";position:absolute;left:12px;right:12px;bottom:0;height:2px;border-radius:2px;background:linear-gradient(90deg,#5fe1ff,#9b7bff);box-shadow:0 0 12px rgba(95,225,255,.7)}
.om-bar-right{margin-left:auto;display:flex;align-items:center;gap:6px}
.om-bar-icon{position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;color:#8fa9c4;transition:background .2s,color .2s}
.om-bar-icon:hover{background:rgba(95,225,255,.08);color:#e8f3ff}
.om-bar-badge{position:absolute;top:3px;right:2px;min-width:15px;height:15px;padding:0 4px;border-radius:99px;background:#f4c35a;color:#1a1200;font:700 9.5px/15px Barlow,sans-serif;text-align:center}
.om-bar-user{display:flex;align-items:center;gap:6px;margin-left:4px;padding:3px 8px 3px 3px;border:1px solid rgba(120,200,255,.16);border-radius:999px;color:#8fa9c4}
.om-bar-user button{display:flex;padding:3px;border-radius:6px;transition:color .2s}.om-bar-user button:hover{color:#e8f3ff}
.om-bar-avatar{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#5fe1ff,#4f5fd8 60%,#2a1e6e);color:#fff;font:600 12px Barlow,sans-serif;box-shadow:0 0 12px rgba(95,225,255,.35)}
@media (max-width:1100px){.om-bar-tabs a{padding:0 9px;letter-spacing:.14em;font-size:10.5px}}
@media (max-width:860px){.om-bar-tabs{display:none}.om-bar{height:52px}}
`;

export function AppShell({
  user,
  children,
}: {
  user: { email: string; displayName: string | null; assistantName: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

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

  // the bell: how many things are really waiting for your approval
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/approvals", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop && j?.ok) setPending(j.data.approvals.length); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(t); };
  }, [pathname]);


  return (
    <GestureProvider>
    <div className="flex min-h-screen flex-col">
      {/* OMEGA top bar: JARVIS · the workspaces · approvals · you */}
      <header className={cn("om-bar", pathname === "/dashboard" && "is-home")}>
        <style dangerouslySetInnerHTML={{ __html: BAR_CSS }} />
        <Link href="/dashboard" className="om-bar-brand" aria-label="JARVIS home">JARVIS</Link>
        <nav className="om-bar-tabs" aria-label="Workspaces">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={isActive(t.href) ? "on" : ""} aria-current={isActive(t.href) ? "page" : undefined}>{t.label}</Link>
          ))}
        </nav>
        <div className="om-bar-right">
          <Link href="/dashboard/activity" className="om-bar-icon" aria-label={pending ? `${pending} waiting for your approval` : "Approval & Activity Center"} title="Approval & Activity Center">
            <Bell className="h-4 w-4" />
            {pending ? <span className="om-bar-badge">{pending}</span> : null}
          </Link>
          <GestureToggle />
          <button onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} className="om-bar-icon hidden lg:flex" aria-label="Fullscreen" title="Fullscreen">
            <Maximize2 className="h-4 w-4" />
          </button>
          <div className="om-bar-user">
            <span className="om-bar-avatar" title={name}>{name[0]?.toUpperCase()}</span>
            <button onClick={lock} aria-label="Lock JARVIS" title="Lock JARVIS (face unlock to return)"><Lock className="h-3.5 w-3.5" /></button>
            <button onClick={logout} aria-label="Log out" title="Log out"><LogOut className="h-3.5 w-3.5" /></button>
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
