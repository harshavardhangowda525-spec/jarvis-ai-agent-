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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactorLogo, RobotFace, Chevrons, Waveform } from "@/components/hud/visuals";
import { useClock } from "@/hooks/useDeviceMetrics";

// Full mission-control nav. Every item routes to a real page (several are
// conceptual aliases of the same working page — e.g. Command Center is the
// console) so nothing 404s.
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard", label: "Command Center", icon: Terminal },
  { href: "/dashboard/operator", label: "Operator", icon: MousePointerClick },
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
  const now = useClock();

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

  const weekday = now.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const date = now
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

  return (
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
        {/* Left nav rail — desktop */}
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

        {/* Content */}
        <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
      </div>

      {/* Bottom nav — mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-accent/20 bg-panel/95 backdrop-blur md:hidden">
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
    </div>
  );
}
