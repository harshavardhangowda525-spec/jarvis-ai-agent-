import { Suspense } from "react";
import { TradingDashboard } from "@/components/trading/trading-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trading Intelligence — MIKE" };

/** MIKE's weekly trading review (?week=YYYY-MM-DD, &revision=n for an earlier version). */
export default function TradingPage() {
  return <Suspense fallback={<div style={{ minHeight: "calc(100dvh - 4rem)", background: "#05070c" }} />}><TradingDashboard /></Suspense>;
}
