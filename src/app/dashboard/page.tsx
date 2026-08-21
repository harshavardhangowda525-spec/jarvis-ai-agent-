import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { JarvisConsole } from "@/components/console/jarvis-console";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const profile = user
    ? await getDb().profile.findUnique({ where: { userId: user.id } })
    : null;
  return <JarvisConsole assistantName={profile?.assistantName ?? "JARVIS"} />;
}
