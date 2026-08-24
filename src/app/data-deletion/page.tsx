import Link from "next/link";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Data Deletion — JARVIS",
  description: "How to delete your JARVIS account and all associated data.",
};

/**
 * Public "User data deletion" instructions page. Meta requires a Data Deletion
 * Instructions URL (or callback) before an app can be submitted. Publicly
 * reachable (not behind auth).
 */
export default function DataDeletion() {
  const appUrl = env.appUrl || "https://your-app.example.com";
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-accent hover:underline">← Back to JARVIS</Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">User Data Deletion</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You control your data and can delete it at any time.
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-lg font-medium">Delete your data yourself (fastest)</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Sign in to JARVIS at <span className="break-all">{appUrl}</span>.</li>
            <li>Go to <strong>Settings</strong>.</li>
            <li>To revoke a connected platform (e.g. Instagram or Google), open <strong>Integrations</strong> and click <strong>Disconnect</strong> — this immediately deletes the access tokens the app stored for that service.</li>
            <li>To remove all your content and your account, use <strong>Delete account</strong> in Settings. This permanently erases your profile, chats, tasks, notes, memories, and any stored integration tokens.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-medium">Request deletion by email</h2>
          <p className="mt-2">
            If you can&apos;t sign in, send a deletion request to the app owner at the email
            associated with this deployment. Include the email address you registered with so we
            can locate and remove your account. We will delete your data and confirm within 30 days.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium">What gets deleted</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your account and login credentials.</li>
            <li>All chats, tasks, notes, and saved memories.</li>
            <li>Access tokens for every connected service (Google, Instagram/Meta, and any data sources).</li>
          </ul>
          <p className="mt-2">
            Data processed only transiently (such as voice audio used to generate a transcript) is
            not retained and therefore requires no separate deletion.
          </p>
        </section>

        <p className="text-xs text-muted-foreground">
          See our <Link href="/privacy" className="text-accent hover:underline">Privacy Policy</Link> for full details on what we store and why.
        </p>
      </div>
    </main>
  );
}
