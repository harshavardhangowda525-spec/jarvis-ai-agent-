import { createHmac } from "node:crypto";

/** The signature a RUBIN webhook sender must put in `x-robin-signature`. */
export function signRobinWebhook(secret: string, ts: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}
