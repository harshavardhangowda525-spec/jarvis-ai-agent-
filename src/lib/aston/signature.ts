import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signatures for ASTON (pure, no I/O).
 *
 * Generic events: `x-aston-signature: sha256=<hex HMAC of "${ts}.${body}">` and
 * `x-aston-timestamp: <unix seconds>`, rejected when older than 5 minutes.
 * GitHub: `x-hub-signature-256: sha256=<hex HMAC of body>` (GitHub's format).
 */

export function signAstonEvent(secret: string, ts: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}

export function signGithub(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyAstonEvent(secret: string, ts: string, sig: string, body: string, nowSec = Date.now() / 1000): boolean {
  if (!secret || !ts || !sig) return false;
  const age = Math.abs(nowSec - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  return same(signAstonEvent(secret, ts, body), sig);
}

export function verifyGithub(secret: string, sig: string, body: string): boolean {
  if (!secret || !sig) return false;
  return same(signGithub(secret, body), sig);
}
