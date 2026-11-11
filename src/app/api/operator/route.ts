import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { INFINITY_TEMPLATE, OPERATOR_MAX_CHARS, loadOperator, saveOperator, unfilledBlanks } from "@/lib/ai/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (op: Awaited<ReturnType<typeof loadOperator>>) => ({
  ...op, chars: op.content.length, max: OPERATOR_MAX_CHARS, blanks: unfilledBlanks(op.content),
  isTemplate: op.content === INFINITY_TEMPLATE,
});

/** The operating manual JARVIS and its agents follow, plus every [FILL …] still blank. */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(view(await loadOperator(user.id)));
  } catch (e) { return handleError(e); }
}

const Body = z.object({ content: z.string().max(OPERATOR_MAX_CHARS).optional(), enabled: z.boolean().optional(), reset: z.literal(true).optional() });

/** Save edits, switch it on/off, or `reset: true` to go back to the original template. */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const b = Body.parse(await req.json());
    return ok(view(await saveOperator(user.id, { content: b.reset ? INFINITY_TEMPLATE : b.content, enabled: b.enabled })));
  } catch (e) {
    return e instanceof z.ZodError ? fail(`The manual must be under ${OPERATOR_MAX_CHARS.toLocaleString()} characters.`) : e instanceof Error && /too long/.test(e.message) ? fail(e.message) : handleError(e);
  }
}
