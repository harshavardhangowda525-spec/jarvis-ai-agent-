import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";

/**
 * Calling people the user knows, for them: "call Mom and tell her I'll be
 * late". The user asking IS the go-ahead for that one call; JARVIS never calls
 * anyone on its own.
 */
const callSchema = z.object({
  who: z.string().min(1).max(60).describe("Who to call, as the user said it: 'Mom', 'Ravi', 'my brother'."),
  message: z.string().min(2).max(400).describe("What JARVIS should tell them, rewritten for the listener in third person with the user's first name — e.g. user says 'tell her I'll be late' → 'Harsha will be a bit late tonight'."),
  phone: z.string().max(30).optional().describe("Only if the user gave the number in this same request."),
});
export const callPersonTool: ToolDefinition<z.infer<typeof callSchema>> = {
  name: "call_person",
  description:
    "Phone someone the USER knows and pass on a message for them, then talk with them and report back: 'call Mom and tell her I'll be late', 'ring Ravi and say the meeting moved to 5'. " +
    "JARVIS says it's the user's AI assistant, gives the message, answers only from it (questions it can't answer go back to the user) and tells the user what they said. " +
    "Only when the user asks for this call. Not for leads/clients (use crm_plan_calls) and not for calling the user (use call_me).",
  schema: callSchema,
  inputSchema: { type: "object", properties: { who: { type: "string" }, message: { type: "string" }, phone: { type: "string" } }, required: ["who", "message"] },
  agentScope: "jarvis",
  activityLabel: "Calling for you",
  async execute(i, ctx) {
    const { queuePersonalCall, PersonalCallError } = await import("@/lib/calls/personal");
    try {
      const { call, contact } = await queuePersonalCall(ctx.userId, { who: i.who, message: i.message, phone: i.phone ?? null });
      return { data: { callId: call.id, calling: contact.name, message: call.message, note: `Calling ${contact.name} from the laptop within about 20 seconds; JARVIS's Calls window shows the conversation live, and I'll tell you what they said when it ends.` }, summary: `Calling ${contact.name}.` };
    } catch (e) { if (e instanceof PersonalCallError) throw new ToolError(e.message); throw e; }
  },
};

const contactSchema = z.object({
  name: z.string().min(1).max(60).describe("The name the user uses: 'Mom', 'Ravi', 'Akka'."),
  phone: z.string().min(6).max(30),
  relation: z.string().max(40).optional().describe("mother, father, brother, friend… if known."),
});
export const saveContactTool: ToolDefinition<z.infer<typeof contactSchema>> = {
  name: "save_contact",
  description: "Save or update a person's phone number so JARVIS can call them for the user later: 'Mom's number is 98…', 'save Ravi as +91 …'.",
  schema: contactSchema,
  inputSchema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, relation: { type: "string" } }, required: ["name", "phone"] },
  agentScope: "jarvis",
  activityLabel: "Saving a contact",
  async execute(i, ctx) {
    const { saveContact, PersonalCallError } = await import("@/lib/calls/personal");
    try { const c = await saveContact(ctx.userId, i); return { data: { saved: c.name, phone: c.phone, relation: c.relation }, summary: `Saved ${c.name}.` }; }
    catch (e) { if (e instanceof PersonalCallError) throw new ToolError(e.message); throw e; }
  },
};

const resultsSchema = z.object({ who: z.string().max(60).optional().describe("Only calls to this person ('Mom'), if the user named someone.") });
export const personalCallsTool: ToolDefinition<z.infer<typeof resultsSchema>> = {
  name: "personal_calls",
  description: "What happened on the calls JARVIS made for the user to people they know — 'what did Mom say?', 'did you reach Ravi?'. Returns each call's status and what the person said.",
  schema: resultsSchema,
  inputSchema: { type: "object", properties: { who: { type: "string", description: "Only calls to this person, if named." } } },
  agentScope: "jarvis",
  activityLabel: "Checking your calls",
  async execute(i, ctx) {
    const { recentPersonalCalls, matchContact } = await import("@/lib/calls/personal");
    let calls = await recentPersonalCalls(ctx.userId, 12);
    if (i.who) {
      const hit = matchContact(i.who, calls.map((c) => ({ name: c.name, aliases: [], relation: null })));
      if (hit) calls = calls.filter((c) => c.name === hit.name);
    }
    calls = calls.slice(0, 6);
    return { data: { calls: calls.map((c) => ({ to: c.name, message: c.message, status: c.status.replace(/_/g, " "), whatTheySaid: c.summary, at: c.createdAt })) }, summary: `${calls.length} recent call${calls.length === 1 ? "" : "s"}.` };
  },
};
