import Link from "next/link";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Privacy Policy — JARVIS",
  description: "How JARVIS collects, uses, stores, and deletes your data.",
};

const UPDATED = "August 24, 2026";

/**
 * Public privacy policy. Required for Meta/Instagram, Google OAuth verification,
 * and general app-store review. Publicly reachable (not behind auth).
 */
export default function PrivacyPolicy() {
  const appUrl = env.appUrl || "https://your-app.example.com";
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-accent hover:underline">← Back to JARVIS</Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <div className="prose-invert mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-lg font-medium">1. Who we are</h2>
          <p>
            JARVIS (&quot;the app&quot;, &quot;we&quot;, &quot;us&quot;) is a personal AI
            assistant operated by the account owner of this deployment. This policy explains
            what data the app processes, why, and how you can have it deleted. You can reach us
            using the contact details in Section 9.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium">2. Data we collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Account data:</strong> your email address and a securely hashed password when you register.</li>
            <li><strong>Content you create:</strong> chat messages, tasks, notes, and memories you save in the app.</li>
            <li><strong>Voice data:</strong> if you use voice, audio is streamed to our speech provider to produce a transcript. Audio is processed transiently to generate text and is not stored by the app.</li>
            <li><strong>Connected services:</strong> if you connect an integration (e.g. Google, Instagram, or a Supabase-backed data source), we store the access tokens needed to call that service on your behalf, and we read only the data required to answer your requests.</li>
            <li><strong>Technical data:</strong> standard server logs (such as request time and error diagnostics) used to keep the service running.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-medium">3. How we use your data</h2>
          <p>We use your data only to provide the assistant&apos;s features: authenticating you, responding to your requests, running the tools you invoke, and remembering the information you ask it to keep. We do not sell your data, and we do not use it for advertising.</p>
        </section>

        <section>
          <h2 className="text-lg font-medium">4. Third-party processors</h2>
          <p>To provide its features the app sends the minimum necessary data to service providers, which may include:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>AI model providers (for reasoning and vision), to process your prompts and any images you choose to share.</li>
            <li>A text-to-speech / speech-to-text provider, to generate the voice and transcribe your speech.</li>
            <li>A database host, to store your account and content.</li>
            <li>Services you explicitly connect (e.g. Google, Instagram/Meta, Supabase data sources), accessed only with your authorization.</li>
          </ul>
          <p>Each provider processes data under its own privacy terms.</p>
        </section>

        <section>
          <h2 className="text-lg font-medium">5. Data from connected platforms (Meta / Instagram, Google)</h2>
          <p>When you connect a platform such as Instagram or Google, the app accesses only the information covered by the permissions you grant during login, and uses it solely to fulfill the actions you ask JARVIS to perform. We do not transfer this platform data to any party except the processors listed above that are required to deliver the feature, and we retain it only as long as the connection is active or until you request deletion.</p>
        </section>

        <section>
          <h2 className="text-lg font-medium">6. Data retention</h2>
          <p>Account and content data is kept until you delete it or request account deletion. Access tokens for connected services are kept until you disconnect that service or delete your account.</p>
        </section>

        <section>
          <h2 className="text-lg font-medium">7. Your rights &amp; data deletion</h2>
          <p>You can access, export, or delete your data at any time. To delete your data, follow the instructions on our{" "}
            <Link href="/data-deletion" className="text-accent hover:underline">Data Deletion page</Link>. Disconnecting an integration in Settings immediately revokes the app&apos;s stored tokens for that service.</p>
        </section>

        <section>
          <h2 className="text-lg font-medium">8. Security</h2>
          <p>Passwords are stored only as salted hashes, secrets are held server-side and never exposed to the browser, and connections use HTTPS. No system is perfectly secure, but we take reasonable measures to protect your data.</p>
        </section>

        <section>
          <h2 className="text-lg font-medium">9. Contact</h2>
          <p>For any privacy request or question, contact the app owner at the email associated with this deployment. The app is hosted at <span className="break-all">{appUrl}</span>.</p>
        </section>

        <section>
          <h2 className="text-lg font-medium">10. Changes</h2>
          <p>We may update this policy; material changes will be reflected by the &quot;Last updated&quot; date above.</p>
        </section>
      </div>
    </main>
  );
}
