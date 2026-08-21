import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { SettingsClient } from "@/components/settings-client";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader title="Settings" subtitle="Personalize JARVIS" />
      <Suspense>
        <SettingsClient />
      </Suspense>
    </div>
  );
}
