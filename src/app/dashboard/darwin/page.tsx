import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** DARWIN was retired — JARVIS runs the CRM itself. Old links land there. */
export default function OldDarwinPage() {
  redirect("/dashboard/crm");
}
