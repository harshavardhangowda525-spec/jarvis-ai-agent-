import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** ROBIN is now RUBIN — old links (bookmarks, reminder emails) land on the new address. */
export default function OldRobinPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams ?? {})) for (const x of Array.isArray(v) ? v : v ? [v] : []) q.append(k, x);
  redirect(`/dashboard/rubin${q.size ? `?${q}` : ""}`);
}
