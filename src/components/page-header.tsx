export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-accent/12 px-5 py-4">
      <div>
        <h1 className="hud-label text-base text-foreground">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
