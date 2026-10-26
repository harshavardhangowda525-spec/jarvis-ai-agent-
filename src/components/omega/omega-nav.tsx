"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The OMEGA top navigation: JARVIS home and the three workspaces. The
 * approvals badge is the real number of items waiting for you.
 */
const LINKS = [
  { href: "/dashboard", label: "JARVIS Home" },
  { href: "/dashboard/intel", label: "Business Intelligence" },
  { href: "/dashboard/nexus", label: "Agent Command Nexus" },
  { href: "/dashboard/activity", label: "Activity Center" },
];

export function OmegaNav({ compact = false }: { compact?: boolean }) {
  const path = usePathname();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/approvals", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop && j?.ok) setPending(j.data.approvals.length); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return (
    <nav className={`om-nav${compact ? " compact" : ""}`} aria-label="JARVIS workspaces">
      <style dangerouslySetInnerHTML={{ __html: NAV_CSS }} />
      {LINKS.map((l) => {
        const on = l.href === "/dashboard" ? path === l.href : path?.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
            {l.label}
            {l.href === "/dashboard/activity" && pending ? <span className="om-nav-badge" aria-label={`${pending} waiting for you`}>{pending}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

const NAV_CSS = `
.om-nav{display:flex;gap:2px;align-items:center;justify-content:center;flex-wrap:wrap;padding:4px;border:1px solid rgba(120,200,255,.16);border-radius:999px;background:rgba(4,12,24,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);width:max-content;max-width:100%;margin:0 auto}
.om-nav a{position:relative;font:500 11px "Barlow Condensed",Barlow,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#8fa9c4;text-decoration:none;padding:7px 14px;border-radius:999px;transition:color .2s,background .2s;white-space:nowrap}
.om-nav a:hover{color:#e8f3ff}
.om-nav a.on{color:#f2f8ff;background:linear-gradient(180deg,rgba(95,225,255,.16),rgba(95,225,255,.04));box-shadow:inset 0 0 0 1px rgba(95,225,255,.35)}
.om-nav a.on::after{content:"";position:absolute;left:30%;right:30%;bottom:2px;height:1px;background:#5fe1ff;box-shadow:0 0 8px #5fe1ff}
.om-nav-badge{display:inline-block;margin-left:6px;min-width:17px;padding:0 5px;border-radius:999px;background:#f4c35a;color:#1a1200;font:700 10px Barlow,sans-serif;letter-spacing:0;text-align:center;line-height:16px}
.om-nav.compact a{padding:6px 10px;letter-spacing:.16em}
@media (max-width:640px){.om-nav{border-radius:14px}.om-nav a{padding:6px 9px;letter-spacing:.12em;font-size:10px}}
`;
