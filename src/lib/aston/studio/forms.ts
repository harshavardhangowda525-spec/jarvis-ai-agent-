import "server-only";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { projectSpecSchema, type FormSpec } from "./spec";

/**
 * The real handler behind every ASTON site's forms. Checks the form exists in
 * the project's plan, validates every field on the server too, stores the
 * submission, and for bookings refuses a slot that's already taken. What it
 * returns is exactly what the visitor sees.
 */
export class FormError extends Error { constructor(message: string, public status = 400) { super(message); } }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validate(form: FormSpec, data: Record<string, unknown>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of form.fields) {
    const raw = data[f.name];
    if (f.type === "checkbox") { out[f.name] = raw === true || raw === "on" || raw === "true"; if (f.required && !out[f.name]) throw new FormError(`Please tick "${f.label}".`); continue; }
    const v = typeof raw === "string" ? raw.trim().slice(0, f.type === "textarea" ? 3000 : 300) : typeof raw === "number" ? String(raw) : "";
    if (!v) { if (f.required) throw new FormError(`Please fill in "${f.label}".`); continue; }
    if (f.type === "email" && !EMAIL.test(v)) throw new FormError("Please enter a valid email address.");
    if (f.type === "tel" && !/^[+()\d\s-]{7,20}$/.test(v)) throw new FormError("Please enter a valid phone number.");
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FormError(`Please pick a date for "${f.label}".`);
    if (f.type === "time" && !/^\d{2}:\d{2}$/.test(v)) throw new FormError(`Please pick a time for "${f.label}".`);
    if (f.type === "select" && f.options?.length && !f.options.includes(v)) throw new FormError(`Please choose an option for "${f.label}".`);
    out[f.name] = v;
  }
  return out;
}

/** A booking's slot: its date (+ time) field values. */
export function slotOf(form: FormSpec, data: Record<string, string | boolean>): string | null {
  if (form.kind !== "booking") return null;
  const date = form.fields.find((f) => f.type === "date");
  const time = form.fields.find((f) => f.type === "time");
  const d = date ? data[date.name] : null;
  if (!d) return null;
  return `${d}${time && data[time.name] ? ` ${data[time.name]}` : ""}`;
}

export async function submitForm(token: string, body: unknown) {
  const b = (body ?? {}) as { form?: unknown; data?: unknown };
  const p = await getDb().astonProject.findUnique({ where: { previewToken: token }, select: { id: true, spec: true, testKey: true } });
  if (!p) throw new FormError("This form isn't connected to a site.", 404);
  const spec = projectSpecSchema.safeParse(p.spec);
  const form = spec.success ? spec.data.forms.find((f) => f.id === String(b.form ?? "")) : null;
  if (!form) throw new FormError("This form isn't set up on the site.", 404);
  const data = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
  if (typeof data._gotcha === "string" && data._gotcha) return { ok: true, message: form.success }; // a bot filled the hidden field — accept silently, store nothing
  const test = typeof data._aston_test === "string" && data._aston_test === p.testKey;
  const clean = validate(form, data);
  const slot = slotOf(form, clean);
  try {
    await getDb().astonSubmission.create({ data: { projectId: p.id, form: form.id, data: clean as Prisma.InputJsonValue, slot, test } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new FormError("Sorry, that time is already booked — please choose another.", 409);
    throw e;
  }
  return { ok: true, message: form.success };
}
