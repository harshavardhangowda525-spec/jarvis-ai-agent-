/**
 * JARVIS Face ID templates at rest: the enrolled descriptors (128 numbers each,
 * never images), encrypted with AES-256-GCM under a key derived from this
 * server's AUTH_SECRET. Nothing ever sends a template back to a browser — it's
 * only decrypted here, on the server, to compare against a scan.
 *
 * Each server secret has its own key id, so a JARVIS on your PC and one on
 * Vercel (with different AUTH_SECRETs) each keep their own enrolment in the
 * shared database instead of failing to read each other's.
 */
import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { DESCRIPTOR_LENGTH } from "./face-match";

function key(): Buffer {
  if (!env.authSecret) throw new Error("AUTH_SECRET is not configured");
  return Buffer.from(hkdfSync("sha256", env.authSecret, "jarvis-face-template", "v1", 32));
}

/** Which server secret a template was sealed with (not secret itself). */
export function templateKeyId(): string {
  return createHmac("sha256", key()).update("key-id").digest("hex").slice(0, 16);
}

export function sealTemplate(descriptors: number[][]): { data: Buffer; iv: Buffer; tag: Buffer } {
  const flat = new Float32Array(descriptors.length * DESCRIPTOR_LENGTH);
  descriptors.forEach((d, i) => flat.set(d, i * DESCRIPTOR_LENGTH));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from("jarvis-face-v1"));
  const data = Buffer.concat([c.update(Buffer.from(flat.buffer)), c.final()]);
  return { data, iv, tag: c.getAuthTag() };
}

/** null if it can't be opened (wrong key / tampered). */
export function openTemplate(t: { data: Uint8Array; iv: Uint8Array; tag: Uint8Array }): number[][] | null {
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(t.iv));
    d.setAAD(Buffer.from("jarvis-face-v1"));
    d.setAuthTag(Buffer.from(t.tag));
    const raw = Buffer.concat([d.update(Buffer.from(t.data)), d.final()]);
    const flat = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const out: number[][] = [];
    for (let i = 0; i + DESCRIPTOR_LENGTH <= flat.length; i += DESCRIPTOR_LENGTH) out.push(Array.from(flat.subarray(i, i + DESCRIPTOR_LENGTH)));
    return out;
  } catch {
    return null;
  }
}
