import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { signupSchema } from "@/lib/validation";
import { ok, fail, handleError, rateLimit, clientIp } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`signup:${clientIp(req)}`, 10, 60_000);
    if (!rl.allowed) return fail("Too many attempts. Try again later.", 429);

    const body = await req.json();
    const { email, password, displayName } = signupSchema.parse(body);

    const db = getDb();
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return fail("An account with that email already exists.", 409);

    const passwordHash = await hashPassword(password);
    const user = await db.user.create({
      data: {
        email,
        passwordHash,
        profile: { create: { displayName: displayName || null } },
        voicePreference: { create: {} },
      },
    });

    await createSession(
      { id: user.id, email: user.email },
      {
        userAgent: req.headers.get("user-agent") ?? undefined,
        ipAddress: clientIp(req),
      },
    );

    return ok({ id: user.id, email: user.email }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
