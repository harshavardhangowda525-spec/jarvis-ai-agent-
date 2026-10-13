import type { Metadata } from "next";
import { RubenIsland } from "@/components/island/ruben-island";

export const metadata: Metadata = { title: "RUBEN" };
export const dynamic = "force-dynamic";

/**
 * The RUBEN island — the page the RUBEN desktop app (desktop/rubin) shows in
 * its transparent always-on-top window. Signed-out / locked states are handled
 * in the page (the API answers 401 / 423), so the tiny window never gets
 * redirected to a full-size login form.
 */
export default function IslandPage() {
  return <RubenIsland />;
}
