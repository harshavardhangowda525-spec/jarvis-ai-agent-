import { describe, it, expect } from "vitest";
import * as gateway from "../edith/src/ollama-native.mjs";

// Plain-JS module from the PC gateway (edith/) — typed loosely here.
const { toNativeChat, NativeToOpenAI, describeTimings } = gateway as any;

const O = { model: "qwen2.5:3b", numCtx: 8192, keepAlive: "24h", noThink: false };

describe("gateway: OpenAI request → Ollama native", () => {
  it("always sets keep_alive and the context window; maps max_tokens", () => {
    const n = toNativeChat({ model: "qwen2.5:3b", stream: true, max_tokens: 1024, messages: [{ role: "user", content: "hi" }] }, O);
    expect(n).toMatchObject({ model: "qwen2.5:3b", stream: true, keep_alive: "24h", options: { num_ctx: 8192, num_predict: 1024 } });
    expect(n.think).toBeUndefined();
  });

  it("turns thinking off only for thinking models", () => {
    expect(toNativeChat({ messages: [] }, { ...O, noThink: true }).think).toBe(false);
  });

  it("converts tool calls (string args → object) and names tool results", () => {
    const n = toNativeChat({
      messages: [
        { role: "user", content: "calc" },
        { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "calculator", arguments: "{\"expression\":\"2+2\"}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "4" },
      ],
    }, O);
    expect(n.messages[1].tool_calls).toEqual([{ function: { name: "calculator", arguments: { expression: "2+2" } } }]);
    expect(n.messages[2]).toEqual({ role: "tool", content: "4", tool_name: "calculator" });
  });

  it("flattens multi-part content and extracts base64 images", () => {
    const n = toNativeChat({ messages: [{ role: "user", content: [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }] }, O);
    expect(n.messages[0]).toEqual({ role: "user", content: "what is this", images: ["AAAA"] });
  });
});

describe("gateway: Ollama native stream → OpenAI chunks", () => {
  it("streams text, drops hidden thinking, finishes with stop + usage", () => {
    const c = new NativeToOpenAI("m");
    const out = [
      ...c.push({ message: { role: "assistant", content: "", thinking: "secret" }, done: false }),
      ...c.push({ message: { role: "assistant", content: "Hi" }, done: false }),
      ...c.push({ message: { role: "assistant", content: " there" }, done: false }),
      ...c.push({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 2 }),
    ];
    expect(out.map((o) => o.choices[0].delta.content ?? null)).toEqual(["Hi", " there", null]);
    expect(out[0].choices[0].delta.role).toBe("assistant");
    expect(out.at(-1).choices[0].finish_reason).toBe("stop");
    expect(out.at(-1).usage).toEqual({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("emits tool calls with ids and JSON-string arguments", () => {
    const c = new NativeToOpenAI("m");
    const out = [
      ...c.push({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "calculator", arguments: { expression: "2+2" } } }] }, done: false }),
      ...c.push({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }),
    ];
    const call = out[0].choices[0].delta.tool_calls[0];
    expect(call).toMatchObject({ index: 0, type: "function", function: { name: "calculator", arguments: "{\"expression\":\"2+2\"}" } });
    expect(call.id).toMatch(/^call_/);
    expect(out.at(-1).choices[0].finish_reason).toBe("tool_calls");
    expect(c.completion().choices[0].message.tool_calls[0]).not.toHaveProperty("index");
  });

  it("describes timings for the gateway log", () => {
    expect(describeTimings({ load_duration: 4e9, prompt_eval_count: 900, prompt_eval_duration: 1.5e9, eval_count: 40, eval_duration: 4e9 }))
      .toBe("model load 4.0s · read 900 tokens in 1.5s · wrote 40 at 10.0 tok/s");
  });
});
