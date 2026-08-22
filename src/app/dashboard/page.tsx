import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { JarvisConsole } from "@/components/console/jarvis-console";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const profile = user
    ? await getDb().profile.findUnique({ where: { userId: user.id } })
    : null;
  const userName = profile?.displayName || user?.email.split("@")[0] || "there";
  return (
    <JarvisConsole
      assistantName={profile?.assistantName ?? "JARVIS"}
      userName={userName}
    />
  );
}
