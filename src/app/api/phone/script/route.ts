import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Termux script for the spare phone (no secrets in it — the pairing token is passed when you run it). */
export async function GET() {
  try {
    const body = await fs.readFile(path.join(process.cwd(), "scripts", "phone", "jarvis-phone.sh"), "utf8");
    return new Response(body, { headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return new Response("echo 'jarvis-phone.sh is missing from the JARVIS folder (scripts/phone).'\n", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
}
