import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/aston/auth";
import { AstonConsole } from "@/components/aston/aston-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "ASTON" };

/**
 * ASTON — the voice-first attention manager. A full-screen orb, nothing else:
 * no dashboard, no sidebar. It speaks up when something needs the owner.
 */
export default async function AstonPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/aston");
  if (!isOwner(user.email)) redirect("/dashboard");
  return <AstonConsole />;
}
