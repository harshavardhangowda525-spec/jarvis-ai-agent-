"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  ListTodo,
  StickyNote,
  Brain,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/dashboard/tasks", label: "Tasks", icon: ListTodo },
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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen">
      {/* Left rail — desktop */}
      <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col items-center gap-2 border-r border-border/60 bg-panel/40 py-4 md:flex">
        <Link href="/dashboard" className="mb-4" aria-label="JARVIS home">
          <div className="glow-ring flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-jarvis-cyan to-jarvis-blue text-xs font-bold text-black">
            J
          </div>
        </Link>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className={cn(
                "group relative flex h-11 w-11 items-center justify-center rounded-xl transition",
                isActive(href)
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="pointer-events-none absolute left-14 z-20 whitespace-nowrap rounded-md bg-panel px-2 py-1 text-xs opacity-0 shadow-lg transition group-hover:opacity-100">
                {label}
              </span>
            </Link>
          ))}
        </nav>
        <button
          onClick={logout}
          aria-label="Log out"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">{children}</div>

      {/* Bottom nav — mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-border/60 bg-panel/90 backdrop-blur md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
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
