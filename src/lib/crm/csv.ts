/**
 * CSV for the CRM import (client-safe, no dependencies). Handles quoted
 * fields, escaped quotes (""), commas and newlines inside quotes, CRLF, a
 * UTF-8 BOM, and ; or tab separated files (Excel in some locales).
 */
import type { CrmStatus } from "./status";

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  // the separator the header line uses most (comma unless ; or tab win)
  const [sep] = ([",", ";", "\t"] as const).map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

/** The CRM fields an import can fill. */
export type ImportField =
  | "businessName" | "phone" | "whatsapp" | "email" | "website" | "instagram" | "city" | "address" | "category"
  | "status" | "followUp" | "lastContact" | "notes" | "source" | "externalRef";

export const IMPORT_FIELDS: { id: ImportField; label: string; patterns: RegExp }[] = [
  { id: "businessName", label: "Business name", patterns: /^(business|business ?name|company|company ?name|name|lead|lead ?name|client|client ?name|shop|store|brand|organi[sz]ation)$/ },
  { id: "phone", label: "Phone", patterns: /^(phone|phone ?(no|number)|mobile|mobile ?(no|number)|contact|contact ?(no|number)|tel|telephone|number)$/ },
  { id: "whatsapp", label: "WhatsApp", patterns: /^(whats ?app|wa|whatsapp ?(no|number))$/ },
  { id: "email", label: "Email", patterns: /^(e-?mail|email ?address|mail)$/ },
  { id: "website", label: "Website", patterns: /^(website|web ?site|url|site|web)$/ },
  { id: "instagram", label: "Instagram", patterns: /^(instagram|insta|ig|instagram ?(handle|url|id))$/ },
  { id: "city", label: "City / area", patterns: /^(city|location|area|town|locality|place)$/ },
  { id: "address", label: "Address", patterns: /^(address|full ?address|street)$/ },
  { id: "category", label: "Niche / category", patterns: /^(category|niche|industry|type|business ?type|sector)$/ },
  { id: "status", label: "Status", patterns: /^(status|stage|lead ?status|deal ?stage|pipeline|state)$/ },
  { id: "followUp", label: "Next follow-up date", patterns: /^(follow ?-?up|follow ?-?up ?date|next ?follow ?-?up|next ?action ?date|followup|callback|call ?back)$/ },
  { id: "lastContact", label: "Last contacted", patterns: /^(last ?contact(ed)?|contacted ?(on|at|date)|last ?called|last ?touch)$/ },
  { id: "notes", label: "Notes", patterns: /^(notes?|remarks?|comments?|description|details)$/ },
  { id: "source", label: "Source", patterns: /^(source|lead ?source|channel)$/ },
  { id: "externalRef", label: "Record ID", patterns: /^(id|uuid|lead ?id|record ?id|row ?id)$/ },
];

const normHeader = (h: string) => h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

/** Which column holds which field, guessed from the headers (each field at most once). */
export function guessMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const out: Partial<Record<ImportField, number>> = {};
  headers.forEach((h, i) => {
    const n = normHeader(h);
    const f = IMPORT_FIELDS.find((x) => x.patterns.test(n) && out[x.id] === undefined);
    if (f) out[f.id] = i;
  });
  return out;
}

/**
 * Map a status word from another CRM to a DARWIN status, or null when it's
 * unclear (shown to you to decide — never guessed).
 */
export function guessStatus(raw: string): CrmStatus | null {
  const s = raw.toLowerCase().replace(/[_\-]+/g, " ").trim();
  if (!s) return null;
  if (/do not|dnd|not interested|rejected|reject|lost|dead|closed lost|declined|no thanks|unsubscrib/.test(s)) return "rejected";
  if (/\b(won|converted|client|customer|paid|closed won|signed|deal done)\b/.test(s)) return "converted";
  if (/ready|hot|about to (buy|close)/.test(s)) return "ready";
  if (/proposal|quote|quotation|negotiat|pricing sent/.test(s)) return "proposal";
  if (/demo|meeting (booked|scheduled)|presentation/.test(s)) return "demo";
  if (/interested|follow|call ?back|warm|maybe|thinking/.test(s)) return "interested";
  if (/contacted|called|messaged|dm|reached|no answer|no response|not responding|pending reply|sent|attempted|left (a )?message|voicemail/.test(s)) return "contacted";
  if (/^(new|fresh|not contacted|uncontacted|open|to do|todo|lead)$/.test(s)) return "new";
  return null;
}

/** A date from another CRM: ISO, "2026-10-17 14:00", "17/10/2026", "17-10-2026" (day first — India), or epoch ms. */
export function parseDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{12,13}$/.test(s)) { const d = new Date(Number(s)); return Number.isNaN(+d) ? null : d; }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (dmy) {
    const y = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const d = new Date(y, Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] ?? 10), Number(dmy[5] ?? 0));
    return d.getMonth() === Number(dmy[2]) - 1 ? d : null;
  }
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d;
}
