import "server-only";
import { env } from "@/lib/env";
import { requireUser, type AuthUser } from "@/lib/auth/session";

/**
 * ASTON is the owner's console. When ASTON_OWNER_EMAIL is set, only that
 * signed-in account may read incidents or make decisions; everyone else gets
 * 403 even with a valid session.
 */
export class AstonForbidden extends Error {
  constructor() { super("Only the ASTON owner can do this."); this.name = "AstonForbidden"; }
}

export function isOwner(email: string): boolean {
  return !env.astonOwnerEmail || email.toLowerCase() === env.astonOwnerEmail;
}

export async function requireOwner(): Promise<AuthUser> {
  const user = await requireUser();
  if (!isOwner(user.email)) throw new AstonForbidden();
  return user;
}
