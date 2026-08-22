import { cn } from "@/lib/utils";

/**
 * HUD panel with four drawn corner brackets and an optional section label —
 * the core visual unit of the JARVIS mission-control layout.
 */
export function HudPanel({
  label,
  action,
  className,
  bodyClassName,
  children,
}: {
  label?: string;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("hud-panel", className)}>
      <span className="hud-corners" aria-hidden />
      {label && (
        <header className="flex items-center gap-3 border-b border-accent/10 px-4 py-2.5">
          <h2 className="hud-label text-[11px] text-accent">{label}</h2>
          {action && <div className="ml-auto">{action}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatusDot({ state }: { state: "online" | "standby" | "offline" }) {
  const color =
    state === "online"
      ? "bg-success shadow-[0_0_8px_hsl(var(--success))]"
      : state === "standby"
        ? "bg-warning shadow-[0_0_8px_hsl(var(--warning))]"
        : "bg-muted-foreground/50";
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", color)} />;
}
