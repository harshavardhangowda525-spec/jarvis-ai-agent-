import { redirect } from "next/navigation";

/** EDITH was renamed ULTRON — keep old links and bookmarks working. */
export default function EdithRedirect() {
  redirect("/dashboard/ultron");
}
