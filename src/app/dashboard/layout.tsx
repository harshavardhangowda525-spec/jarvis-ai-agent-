import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const profile = await getDb().profile.findUnique({ where: { userId: user.id } });

  return (
    <AppShell
      user={{
        email: user.email,
        displayName: profile?.displayName ?? null,
        assistantName: profile?.assistantName ?? "JARVIS",
      }}
    >
      {children}
    </AppShell>
  );
}
