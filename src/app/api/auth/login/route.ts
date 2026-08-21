import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validation";
import { ok, fail, handleError, rateLimit, clientIp } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`login:${clientIp(req)}`, 10, 60_000);
    if (!rl.allowed) return fail("Too many attempts. Try again later.", 429);

    const body = await req.json();
    const { email, password } = loginSchema.parse(body);

    const db = getDb();
    const user = await db.user.findUnique({ where: { email } });
    // Constant-ish response: verify against found hash or a dummy to reduce
    // account-enumeration signal, then return the same error message.
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !valid) return fail("Invalid email or password.", 401);

    await createSession(
      { id: user.id, email: user.email },
      {
        userAgent: req.headers.get("user-agent") ?? undefined,
        ipAddress: clientIp(req),
      },
    );

    return ok({ id: user.id, email: user.email });
  } catch (err) {
    return handleError(err);
  }
}
