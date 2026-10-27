import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { PhoneError, pair, phoneStatus, queueTest, saveSettings, unpair } from "@/lib/phone/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const portOf = (req: Request) => new URL(req.url).port || (req.headers.get("host")?.split(":")[1] ?? "3000");

/** Your phone-call settings, whether the spare phone is really checking in, and recent calls. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    return ok(await phoneStatus(user.id, portOf(req)));
  } catch (e) {
    return handleError(e);
  }
}

const hhmm = z.string().max(5).nullable().optional();
const Settings = z.object({
  mode: z.enum(["android", "iphone"]).optional(), iphoneEmail: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(), toNumber: z.string().max(24).nullable().optional(), jarvisNumber: z.string().max(24).nullable().optional(),
  onCompleted: z.boolean().optional(), onFailed: z.boolean().optional(), onApproval: z.boolean().optional(),
  quietFrom: hhmm, quietTo: hhmm,
});

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    await saveSettings(user.id, Settings.parse(await req.json()));
    return ok(await phoneStatus(user.id, portOf(req)));
  } catch (e) {
    return e instanceof PhoneError ? fail(e.message) : handleError(e);
  }
}

/** pair → a new token for the spare phone (shown once) · unpair · test → queue a test call. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { action } = z.object({ action: z.enum(["pair", "unpair", "test"]) }).parse(await req.json());
    if (action === "pair") return ok({ token: await pair(user.id), ...(await phoneStatus(user.id, portOf(req))) });
    if (action === "unpair") await unpair(user.id);
    if (action === "test") await queueTest(user.id);
    return ok(await phoneStatus(user.id, portOf(req)));
  } catch (e) {
    return e instanceof PhoneError ? fail(e.message) : handleError(e);
  }
}
