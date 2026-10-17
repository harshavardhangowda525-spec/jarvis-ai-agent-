import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The agents now live in their chats — old links (bookmarks, reminder emails) land there. */
export default function OldMikePage() {
  redirect("/dashboard/chat/mike");
}
