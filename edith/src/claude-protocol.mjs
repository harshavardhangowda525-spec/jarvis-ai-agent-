/**
 * The Claude bridge's translation layer (pure — no processes, no network).
 *
 * JARVIS speaks the OpenAI chat API with function tools. The Claude app on
 * your PC (`claude -p`, signed in with your Claude plan) takes one prompt and,
 * with --json-schema, returns one structured answer. So:
 *   request  → one prompt: the conversation so far + the tools JARVIS offers
 *   answer   → { reply, tool_calls } → an OpenAI completion (text or tool calls)
 * Claude's own built-in tools (files, shell, web…) are switched off: it only
 * thinks and decides; JARVIS runs its tools, as with every other brain.
 */

const MAX_TOOL_RESULT = 12_000;

const textOf = (content) => {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p?.type === "text" ? p.text : p?.type === "image_url" ? "[image omitted — this brain can't see images]" : "")).join("\n");
  return String(content);
};

/** The JSON schema Claude must answer with (tool names are an enum, so it can't invent one). */
export function answerSchema(toolNames) {
  return {
    type: "object",
    properties: {
      reply: { type: "string", description: "Your message to the user. Empty when you're only calling tools." },
      tool_calls: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string", enum: toolNames }, arguments: { type: "object" } },
          required: ["name", "arguments"],
        },
      },
    },
    required: ["reply", "tool_calls"],
  };
}

/**
 * OpenAI chat request → { system, prompt, schema, toolNames }.
 * `schema` is null when JARVIS offered no tools (a plain text answer).
 */
export function buildRequest(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const tools = (Array.isArray(body?.tools) ? body.tools : []).map((t) => t?.function ?? t).filter((f) => f?.name);
  const toolNames = tools.map((f) => f.name);
  const systemParts = msgs.filter((m) => m.role === "system").map((m) => textOf(m.content)).filter(Boolean);

  // tool results only carry the call id — name them after the call they answer
  const callName = new Map(msgs.flatMap((m) => (m.role === "assistant" ? (m.tool_calls ?? []).map((c) => [c.id, c.function?.name]) : [])));
  const lines = [];
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "user") lines.push(`[USER]\n${textOf(m.content)}`);
    else if (m.role === "assistant") {
      const t = textOf(m.content).trim();
      if (t) lines.push(`[YOU]\n${t}`);
      for (const c of m.tool_calls ?? []) lines.push(`[YOU CALLED ${c.function?.name}] ${c.function?.arguments ?? "{}"}`);
    } else if (m.role === "tool") {
      const r = textOf(m.content);
      lines.push(`[RESULT OF ${m.name ?? callName.get(m.tool_call_id) ?? "the tool"}${m.tool_call_id ? ` (${m.tool_call_id})` : ""}]\n${r.length > MAX_TOOL_RESULT ? `${r.slice(0, MAX_TOOL_RESULT)}\n…(cut)` : r}`);
    }
  }

  const protocol = toolNames.length
    ? [
        "# How to answer (important)",
        "You are the brain behind this assistant. In this session you have NO tools you can call directly: the tools listed below are NOT functions available to you, and calling one directly fails with \"No such tool available\".",
        "Instead, you REQUEST them in your JSON answer (tool_calls). The app runs them for you and shows you the results in the next message, then you continue.",
        "",
        "Tools the app can run for you:",
        ...tools.map((f) => `- ${f.name}: ${String(f.description ?? "").replace(/\s+/g, " ").trim()}\n  parameters: ${JSON.stringify(f.parameters ?? { type: "object" })}`),
        "",
        "Answer with JSON matching the schema:",
        "- to use tools: list them in tool_calls (name + arguments matching that tool's parameters) and leave reply empty or one short line — never say a tool is unavailable; just request it;",
        "- when you're done: tool_calls = [] and reply = your answer to the user.",
        "Never claim a tool ran or what it returned unless its result is in the conversation below.",
      ].join("\n")
    : "";

  const system = [...systemParts, protocol].filter(Boolean).join("\n\n");
  const prompt = `${lines.join("\n\n")}\n\n[Now write your next turn.]`;
  return { system, prompt, schema: toolNames.length ? answerSchema(toolNames) : null, toolNames };
}

/** First JSON object in a string (Claude's `result` when structured_output is missing). */
function firstJson(s) {
  const t = String(s ?? "");
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
}

export class BridgeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** What `claude -p --output-format json` printed → { text, toolCalls }. */
export function parseResult(stdout, toolNames) {
  let out;
  try { out = JSON.parse(String(stdout).trim().split("\n").filter(Boolean).at(-1)); } catch { throw new BridgeError(502, "The Claude app answered something that isn't JSON."); }
  if (out?.is_error || (out?.subtype && out.subtype !== "success")) {
    const msg = String(out?.result ?? out?.subtype ?? "Claude couldn't answer.");
    // a plan limit is a rate limit: JARVIS parks this brain and uses the next one
    if (/limit|quota|rate|overloaded|429/i.test(msg)) throw new BridgeError(429, `Claude: ${msg}`.slice(0, 300));
    if (/log ?in|auth|credential|sign ?in/i.test(msg)) throw new BridgeError(401, `Claude isn't signed in on the PC: ${msg}`.slice(0, 300));
    throw new BridgeError(502, `Claude: ${msg}`.slice(0, 300));
  }
  if (!toolNames.length) return { text: String(out?.result ?? ""), toolCalls: [] };
  const ans = out?.structured_output ?? firstJson(out?.result);
  if (!ans || typeof ans !== "object") return { text: String(out?.result ?? ""), toolCalls: [] };
  const toolCalls = (Array.isArray(ans.tool_calls) ? ans.tool_calls : [])
    .filter((c) => c && toolNames.includes(c.name))
    .map((c, i) => ({ id: `call_${Date.now().toString(36)}_${i}`, name: c.name, arguments: JSON.stringify(c.arguments && typeof c.arguments === "object" ? c.arguments : {}) }));
  return { text: String(ans.reply ?? ""), toolCalls };
}

/** { text, toolCalls } → an OpenAI chat.completion. */
export function toCompletion(model, r) {
  return {
    id: `claude-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
    choices: [{
      index: 0, finish_reason: r.toolCalls.length ? "tool_calls" : "stop",
      message: { role: "assistant", content: r.toolCalls.length && !r.text ? null : r.text, ...(r.toolCalls.length ? { tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) } : {}) },
    }],
  };
}

/** { text, toolCalls } → OpenAI streaming chunks (the whole answer arrives at once). */
export function toChunks(model, r) {
  const base = { id: `claude-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
  const chunk = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
  const out = [chunk({ role: "assistant", content: "" })];
  if (r.text) {
    // a few pieces, so JARVIS can start speaking sentence by sentence
    for (const piece of r.text.match(/[^.!?\n]+[.!?\n]*\s*/g) ?? [r.text]) out.push(chunk({ content: piece }));
  }
  r.toolCalls.forEach((c, i) => out.push(chunk({ tool_calls: [{ index: i, id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } }] })));
  out.push(chunk({}, r.toolCalls.length ? "tool_calls" : "stop"));
  return out;
}

/**
 * The `claude` command-line arguments. The prompt goes on stdin and the system
 * prompt in a file (JARVIS's tool list is too long for a Windows command line).
 */
export function claudeArgs({ model, systemFile, schema }) {
  return [
    "-p", "--output-format", "json",
    "--tools", "",                 // none of Claude's own tools — JARVIS runs the tools
    "--strict-mcp-config",         // and none of your MCP servers
    "--setting-sources", "",       // ignore project/user settings, hooks and CLAUDE.md
    "--disable-slash-commands",
    "--no-session-persistence",
    ...(model ? ["--model", model] : []),
    "--system-prompt-file", systemFile,
    ...(schema ? ["--json-schema", JSON.stringify(schema)] : []),
  ];
}

/**
 * What an npm `claude.cmd` shim on Windows really starts — a .exe or a .js file
 * (relative to the shim's folder) — so the bridge can run it WITHOUT a shell
 * (cmd.exe would mangle the JSON schema argument). null if it can't tell.
 */
export function shimTarget(cmdText) {
  const hits = [...String(cmdText).matchAll(/%~?dp0%?\\?([^"%\r\n]*?\.(?:exe|c?js|mjs))"/gi)].map((m) => m[1]).filter((f) => !/(^|\\|\/)node\.exe$/i.test(f));
  const f = hits[0];
  return f ? { file: f.replace(/\\/g, "/"), node: !/\.exe$/i.test(f) } : null;
}

/** Claude tried to call the app's tools directly (they don't exist in its session) instead of requesting them. */
export function triedDirectToolCall(r) {
  return !r.toolCalls.length && /no such tool|tool(?:s)? (?:is|are|was|were)? ?(?:not )?(?:un)?available|returned "no such tool/i.test(r.text);
}
