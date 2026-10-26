#!/usr/bin/env node
/**
 * Save one setting in .env.local and (for known keys) check it works:
 *   npm run set-key -- YOUTUBE_API_KEY AIza...
 * Replaces every existing line for that name (including empty ones a
 * `vercel env pull` left behind), so there is exactly one. Never prints the value.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [name, ...rest] = process.argv.slice(2);
const value = rest.join(" ").trim().replace(/^["']|["']$/g, "");

if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name) || !value) {
  console.log('Usage:  npm run set-key -- YOUTUBE_API_KEY your-key-here');
  process.exit(1);
}
if (/PASTE|YOUR[-_ ]?KEY|your-key-here/i.test(value)) {
  console.log("Replace the placeholder with your real key, then run it again.");
  process.exit(1);
}

const file = path.join(ROOT, ".env.local");
const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^﻿/, "") : "";
const kept = text.split(/\r?\n/).filter((l) => !new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(l));
while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
kept.push(`${name}="${value}"`, "");
fs.writeFileSync(file, kept.join("\n"));
console.log(`Saved ${name} in .env.local (${value.length} characters).`);

if (name === "YOUTUBE_API_KEY") {
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=@OpenAI&key=${encodeURIComponent(value)}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.items?.length) console.log(`✓ YouTube accepted the key (found the "${j.items[0].snippet.title}" channel).`);
    else {
      const msg = j.error?.message ?? `HTTP ${r.status}`;
      console.log(`✗ YouTube refused the key: ${msg}`);
      if (/not been used|disabled/i.test(msg)) console.log("  → Google Cloud → APIs & Services → Library → YouTube Data API v3 → Enable (then wait a minute).");
      else if (/referer|ip address|restrict/i.test(msg)) console.log("  → Google Cloud → Credentials → your key → Application restrictions: None → Save.");
      else if (/not valid/i.test(msg)) console.log("  → The key was copied wrong — copy it again from Google Cloud → Credentials.");
    }
  } catch (e) {
    console.log(`Couldn't reach YouTube to check the key (${e.message}) — it is saved anyway.`);
  }
}
console.log("Restart JARVIS (Ctrl+C, then npm run local) so it picks the setting up.");
