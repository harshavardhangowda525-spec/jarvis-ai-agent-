#!/usr/bin/env node
// Stand-in for the `claude` command (tests only): records how it was called and
// answers like `claude -p --output-format json` would.
import fs from "node:fs";
const args = process.argv.slice(2);
let input = ""; for await (const c of process.stdin) input += c;
const sysFile = args[args.indexOf("--system-prompt-file") + 1];
const system = sysFile && fs.existsSync(sysFile) ? fs.readFileSync(sysFile, "utf8") : "";
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, input, system }) + "\n");
const out = (o) => process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, ...o }) + "\n");
if (args.includes("stream-json") && !args.includes("--json-schema")) {
  // like --output-format stream-json --include-partial-messages: pieces, then the result line
  const text = input.includes("WRITE CODE") ? "<!doctype html>\n<h1>Hello</h1>\n" : "streamed answer";
  for (const piece of text.match(/.{1,6}/gs)) process.stdout.write(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } } }) + "\n");
  out({ result: text });
} else if (input.includes("LIMIT")) out({ is_error: true, subtype: "success", result: "Claude AI usage limit reached|1760000000" });
else if (!args.includes("--json-schema")) out({ result: "ready" });
else if (input.includes("[RESULT OF get_time")) out({ structured_output: { reply: "It's 9:41 in Bengaluru.", tool_calls: [] }, result: "" });
else out({ structured_output: { reply: "", tool_calls: [{ name: "get_time", arguments: { timezone: "Asia/Kolkata" } }, { name: "not_a_tool", arguments: {} }] }, result: "" });
