/** Number formatting shared by MIKE's server answers and UI (no locale surprises). */

export function decimalsFor(price: number): number {
  const a = Math.abs(price);
  return a >= 1000 ? 2 : a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8;
}

export function fmtPrice(p: number | null | undefined, decimals?: number): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const d = decimals ?? decimalsFor(p);
  const [int, frac] = Math.abs(p).toFixed(d).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${p < 0 ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

export function fmtPct(p: number | null | undefined, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(digits)}%`;
}

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
