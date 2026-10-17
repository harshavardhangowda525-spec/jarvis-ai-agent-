import { redirect } from "next/navigation";

/** /dashboard/chat → the first agent's chat. */
export default function ChatIndex() {
  redirect("/dashboard/chat/darwin");
}
