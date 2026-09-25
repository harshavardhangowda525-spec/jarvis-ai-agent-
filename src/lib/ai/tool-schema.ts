/**
 * Small models often fill a tool parameter they don't need with `null`
 * (e.g. open_link {"site": null, "url": "https://…"}). Groq and Cerebras check
 * tool calls against the JSON schema on their side and reject the whole reply
 * ("Tool call validation failed … expected string, but got null"), so for them
 * every OPTIONAL parameter also accepts null; the null is then dropped before
 * the tool's own validation runs, exactly as if the field had been left out.
 */

type Schema = Record<string, any>;

/** Providers that validate tool-call arguments against the schema server-side. */
export const VALIDATES_TOOL_ARGS = new Set(["groq", "cerebras"]);

/** Copy of a tool's JSON schema where each optional property also allows null. */
export function allowNullOptionals(schema: Schema): Schema {
  if (!schema || schema.type !== "object" || !schema.properties) return schema;
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const properties: Schema = {};
  for (const [key, prop] of Object.entries<Schema>(schema.properties)) {
    if (required.has(key) || !prop || typeof prop !== "object") { properties[key] = prop; continue; }
    const p: Schema = { ...prop };
    if (typeof p.type === "string") p.type = [p.type, "null"];
    else if (Array.isArray(p.type) && !p.type.includes("null")) p.type = [...p.type, "null"];
    if (Array.isArray(p.enum) && !p.enum.includes(null)) p.enum = [...p.enum, null];
    properties[key] = p;
  }
  return { ...schema, properties };
}

/** Top-level `null` arguments → left out (the tool treats them as not given). */
export function dropNullArgs(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  return Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== null));
}

/** Did the provider reject the model's tool call (bad arguments / unknown tool)? */
export function isToolCallRejection(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: { code?: string; message?: string } };
  if (e?.status !== 400) return false;
  const text = `${e.message ?? ""} ${e.error?.code ?? ""} ${e.error?.message ?? ""}`;
  return /tool call validation failed|tool_use_failed|failed to call a function|did not match schema/i.test(text);
}
