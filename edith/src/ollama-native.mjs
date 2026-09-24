/**
 * OpenAI-style chat request → Ollama's NATIVE /api/chat, and the answer back
 * into the OpenAI format JARVIS expects (streamed SSE or one JSON body).
 *
 * Why not just forward to Ollama's /v1 endpoint? The OpenAI-compatible endpoint
 * can't set the options that decide how fast a local model feels:
 *   • keep_alive — /v1 requests reset it to Ollama's 5-minute default, so the
 *     model unloads between chats and the next question waits 10–30s to reload.
 *   • num_ctx    — a too-small context window cuts the prompt, which throws
 *     away Ollama's prompt cache and makes it re-read everything every turn.
 *   • think      — "thinking" models (qwen3, deepseek-r1, …) otherwise write a
 *     long hidden essay before every reply.
 */
import crypto from "node:crypto";

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("\n");
};

const imagesOf = (content) => {
  if (!Array.isArray(content)) return [];
  return content
    .filter((p) => p?.type === "image_url")
    .map((p) => String(p.image_url?.url ?? p.image_url ?? ""))
    .map((u) => (u.startsWith("data:") ? u.slice(u.indexOf(",") + 1) : ""))
    .filter(Boolean);
};

const parseArgs = (a) => {
  if (a && typeof a === "object") return a;
  try { return a ? JSON.parse(a) : {}; } catch { return {}; }
};

/**
 * @param {any} body  OpenAI chat.completions request body
 * @param {{ model: string, numCtx: number, keepAlive: string, noThink: boolean }} o
 */
export function toNativeChat(body, o) {
  const toolNames = new Map(); // tool_call_id → function name (for tool results)
  const messages = (body.messages ?? []).map((m) => {
    const out = { role: m.role === "developer" ? "system" : m.role, content: textOf(m.content) };
    const images = imagesOf(m.content);
    if (images.length) out.images = images;
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      out.tool_calls = m.tool_calls.map((tc) => {
        if (tc.id) toolNames.set(tc.id, tc.function?.name);
        return { function: { name: tc.function?.name, arguments: parseArgs(tc.function?.arguments) } };
      });
    }
    if (m.role === "tool") {
      const name = toolNames.get(m.tool_call_id) ?? m.name;
      if (name) out.tool_name = name;
    }
    return out;
  });

  const options = { num_ctx: o.numCtx };
  const maxTokens = body.max_tokens ?? body.max_completion_tokens;
  if (typeof maxTokens === "number") options.num_predict = maxTokens;
  for (const k of ["temperature", "top_p", "seed"]) if (typeof body[k] === "number") options[k] = body[k];
  if (body.stop) options.stop = Array.isArray(body.stop) ? body.stop : [body.stop];

  const req = {
    model: body.model || o.model,
    messages,
    stream: body.stream === true,
    keep_alive: o.keepAlive,
    options,
  };
  if (Array.isArray(body.tools) && body.tools.length) req.tools = body.tools;
  if (o.noThink) req.think = false;
  const rf = body.response_format;
  if (rf?.type === "json_object") req.format = "json";
  else if (rf?.type === "json_schema" && rf.json_schema?.schema) req.format = rf.json_schema.schema;
  return req;
}

/** Turns Ollama's native answer (one chunk at a time) into OpenAI chunks. */
export class NativeToOpenAI {
  constructor(model) {
    this.id = `chatcmpl-${crypto.randomBytes(9).toString("base64url")}`;
    this.created = Math.floor(Date.now() / 1000);
    this.model = model;
    this.sentRole = false;
    this.toolIndex = 0;
    this.content = "";
    this.toolCalls = [];
    this.final = null; // Ollama's last line (timings, token counts)
  }

  chunk(delta, finish = null, extra = {}) {
    return { id: this.id, object: "chat.completion.chunk", created: this.created, model: this.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra };
  }

  /** One native NDJSON object → zero or more OpenAI stream chunks. */
  push(obj) {
    const out = [];
    const msg = obj.message ?? {};
    // msg.thinking (hidden reasoning) is deliberately dropped.
    if (msg.content) {
      this.content += msg.content;
      out.push(this.chunk({ ...(this.sentRole ? {} : { role: "assistant" }), content: msg.content }));
      this.sentRole = true;
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const call = {
          index: this.toolIndex++,
          id: tc.id || `call_${crypto.randomBytes(6).toString("hex")}`,
          type: "function",
          function: { name: tc.function?.name ?? "", arguments: JSON.stringify(tc.function?.arguments ?? {}) },
        };
        this.toolCalls.push(call);
        out.push(this.chunk({ ...(this.sentRole ? {} : { role: "assistant", content: "" }), tool_calls: [call] }));
        this.sentRole = true;
      }
    }
    if (obj.done) {
      this.final = obj;
      out.push(this.chunk({}, this.finishReason(), { usage: this.usage() }));
    }
    return out;
  }

  finishReason() {
    if (this.toolCalls.length) return "tool_calls";
    return this.final?.done_reason === "length" ? "length" : "stop";
  }

  usage() {
    const p = this.final?.prompt_eval_count ?? 0;
    const c = this.final?.eval_count ?? 0;
    return { prompt_tokens: p, completion_tokens: c, total_tokens: p + c };
  }

  /** Non-streamed OpenAI response after all native chunks were pushed. */
  completion() {
    return {
      id: this.id, object: "chat.completion", created: this.created, model: this.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: this.content, ...(this.toolCalls.length ? { tool_calls: this.toolCalls.map(({ index, ...c }) => c) } : {}) },
        finish_reason: this.finishReason(),
      }],
      usage: this.usage(),
    };
  }
}

/** Human summary of Ollama's timings for the gateway log. */
export function describeTimings(final) {
  if (!final) return "";
  const s = (ns) => (ns ?? 0) / 1e9;
  const parts = [];
  if (s(final.load_duration) > 1) parts.push(`model load ${s(final.load_duration).toFixed(1)}s`);
  if (final.prompt_eval_count) parts.push(`read ${final.prompt_eval_count} tokens in ${s(final.prompt_eval_duration).toFixed(1)}s`);
  if (final.eval_count && final.eval_duration) parts.push(`wrote ${final.eval_count} at ${(final.eval_count / s(final.eval_duration)).toFixed(1)} tok/s`);
  return parts.join(" · ");
}

/** Split an NDJSON byte stream into parsed objects. */
export async function* ndjson(readable) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const part of readable) {
    buf += decoder.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { yield JSON.parse(line); } catch { /* partial / junk line */ } }
    }
  }
  const rest = buf.trim();
  if (rest) { try { yield JSON.parse(rest); } catch { /* ignore */ } }
}
