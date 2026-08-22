"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ListChecks,
  StickyNote,
  Brain,
  Settings,
  LogOut,
  Maximize2,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
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

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-accent/12 px-4">
        <Link href="/dashboard" className="flex items-baseline gap-3">
          <span className="hud-display text-2xl text-foreground">JARVIS</span>
          <span className="hidden text-[9px] uppercase leading-tight tracking-[0.2em] text-muted-foreground sm:block">
            Just a really very
            <br />
            intelligent system
          </span>
        </Link>

        <div className="mx-auto hidden items-center gap-2 md:flex">
          <span className="hud-label text-[10px] text-muted-foreground">System</span>
          <span className="hud-label text-[10px] text-accent">Online</span>
          <span className="h-2 w-2 animate-hud-pulse bg-success shadow-[0_0_8px_hsl(var(--success))]" />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            className="hidden h-9 w-9 items-center justify-center rounded text-muted-foreground transition hover:bg-accent/10 hover:text-accent sm:flex"
            aria-label="Fullscreen"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 rounded border border-accent/15 px-2.5 py-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-accent/15 text-xs font-semibold text-accent">
              {name[0]?.toUpperCase()}
            </span>
            <span className="hidden text-sm text-foreground/90 sm:block">Hello, {name}!</span>
            <button onClick={logout} aria-label="Log out" title="Log out">
              <LogOut className="h-4 w-4 text-muted-foreground transition hover:text-destructive" />
            </button>
            <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left nav rail — desktop */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-accent/12 p-3 md:flex">
          <nav className="flex flex-col gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const activeItem = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative flex items-center gap-3 rounded px-3 py-2.5 text-sm transition",
                    activeItem
                      ? "bg-accent/12 text-accent"
                      : "text-muted-foreground hover:bg-accent/[0.06] hover:text-foreground",
                  )}
                >
                  {activeItem && <span className="absolute inset-y-1 left-0 w-0.5 bg-accent" />}
                  <Icon className="h-4 w-4" />
                  <span className="hud-label text-[11px]">{label}</span>
                </Link>
              );
            })}
          </nav>

          {/* System status gauge */}
          <div className="mt-auto flex flex-col items-center gap-2 pb-2 pt-6">
            <Gauge value={online ?? 0} loading={online === null} />
            <div className="hud-label text-[9px] text-muted-foreground">System Status</div>
            <div className="hud-display text-2xl text-accent">
              {online === null ? "—" : `${online}%`}
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
      </div>

      {/* Bottom nav — mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-accent/15 bg-panel/95 backdrop-blur md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[9px] uppercase tracking-wider",
              isActive(href) ? "text-accent" : "text-muted-foreground",
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

function Gauge({ value, loading }: { value: number; loading: boolean }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" stroke="hsl(var(--accent) / 0.15)" strokeWidth="3" />
      {!loading && (
        <circle
          cx="32" cy="32" r={r} fill="none" stroke="hsl(var(--accent))" strokeWidth="3"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 600ms ease-out" }}
        />
      )}
      <circle cx="32" cy="6" r="2" fill="hsl(var(--accent))" className="animate-hud-pulse" />
    </svg>
  );
}
