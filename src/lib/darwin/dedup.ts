/**
 * Duplicate protection for DARWIN leads. A business is fingerprinted by its
 * strongest identifier available — website domain, then phone, then
 * name+location — so the same business is never stored twice.
 */
import { createHash } from "node:crypto";

export function domainOf(url?: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

export function normalizePhone(phone?: string | null): string {
  return (phone ?? "").replace(/[^\d+]/g, "").replace(/^\+?0+/, "");
}

function slug(s?: string | null): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface LeadKeyInput {
  businessName?: string | null;
  website?: string | null;
  phone?: string | null;
  location?: string | null;
  sourceRef?: string | null;
}

/**
 * Stable fingerprint. Prefers a strong identifier so different discoveries of
 * the same business collide even when other fields differ.
 */
export function leadFingerprint(i: LeadKeyInput): string {
  const domain = domainOf(i.website);
  const phone = normalizePhone(i.phone);
  let basis: string;
  if (i.sourceRef && /place|^ChIJ/i.test(i.sourceRef)) basis = `ref:${i.sourceRef}`;
  else if (domain) basis = `domain:${domain}`;
  else if (phone.length >= 8) basis = `phone:${phone}`;
  else basis = `nameloc:${slug(i.businessName)}|${slug(i.location)}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
