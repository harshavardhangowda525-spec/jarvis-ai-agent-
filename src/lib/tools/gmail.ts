import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getGoogleAccessToken } from "@/lib/integrations/google";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const schema = z.object({
  action: z.enum(["list", "search", "read", "send"]),
  query: z.string().max(300).optional().describe("Gmail search query (for list/search)."),
  id: z.string().max(100).optional().describe("Message id (for 'read')."),
  to: z.string().max(320).optional().describe("Recipient email (for 'send')."),
  subject: z.string().max(300).optional(),
  body: z.string().max(10000).optional(),
  maxResults: z.number().int().min(1).max(10).optional(),
});

function header(headers: any[], name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export const gmailTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "gmail",
  description:
    "Access the user's Gmail. 'list' recent messages, 'search' with a Gmail query " +
    "(e.g. 'from:boss is:unread'), 'read' a message by id, or 'send' an email. " +
    "Requires the user to have connected Google in Settings → Integrations. " +
    "ALWAYS confirm the recipient, subject, and body with the user before 'send'.",
  schema,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "search", "read", "send"] },
      query: { type: "string" },
      id: { type: "string" },
      to: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
      maxResults: { type: "integer" },
    },
    required: ["action"],
  },
  activityLabel: "Accessing Gmail",
  async execute(input, ctx) {
    const token = await getGoogleAccessToken(ctx.userId);
    const auth = { Authorization: `Bearer ${token}` };

    if (input.action === "list" || input.action === "search") {
      const url = new URL(`${API}/messages`);
      url.searchParams.set("maxResults", String(input.maxResults ?? 5));
      if (input.query) url.searchParams.set("q", input.query);
      const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new ToolError("Couldn't read your Gmail.");
      const j: any = await res.json();
      const ids = (j.messages ?? []).slice(0, input.maxResults ?? 5);
      // Fetch lightweight metadata for each.
      const messages = await Promise.all(
        ids.map(async (m: any) => {
          const r = await fetch(
            `${API}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
            { headers: auth, signal: AbortSignal.timeout(15_000) },
          );
          if (!r.ok) return { id: m.id, subject: "(unavailable)", from: "", snippet: "" };
          const d: any = await r.json();
          return {
            id: m.id,
            subject: header(d.payload?.headers, "Subject"),
            from: header(d.payload?.headers, "From"),
            snippet: d.snippet ?? "",
          };
        }),
      );
      return {
        data: { messages },
        summary: `${messages.length} email${messages.length === 1 ? "" : "s"}.`,
      };
    }

    if (input.action === "read") {
      if (!input.id) throw new ToolError("No message id provided.");
      const res = await fetch(`${API}/messages/${input.id}?format=full`, {
        headers: auth,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new ToolError("Couldn't read that email.");
      const d: any = await res.json();
      const body = extractBody(d.payload);
      return {
        data: {
          id: d.id,
          subject: header(d.payload?.headers, "Subject"),
          from: header(d.payload?.headers, "From"),
          date: header(d.payload?.headers, "Date"),
          body: body.slice(0, 6000),
        },
      };
    }

    // send
    if (!input.to || !input.subject || !input.body) {
      throw new ToolError("Sending an email needs a recipient, subject, and body.");
    }
    const mime =
      `To: ${input.to}\r\n` +
      `Subject: ${input.subject}\r\n` +
      `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
      input.body;
    const raw = Buffer.from(mime).toString("base64url");
    const res = await fetch(`${API}/messages/send`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ToolError("Couldn't send the email.");
    return { data: { sent: true, to: input.to }, summary: `Email sent to ${input.to}.` };
  },
};

/** Recursively pull the text/plain body from a Gmail payload. */
function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const t = extractBody(part);
      if (t) return t;
    }
  }
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  return "";
}
