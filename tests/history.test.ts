import { describe, it, expect } from "vitest";
import { trimHistoryForLocal, type ChatTurn } from "@/lib/ai/history";

const convo = (n: number): ChatTurn[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` }));

describe("trimHistoryForLocal", () => {
  it("keeps only the MOST RECENT messages", () => {
    const out = trimHistoryForLocal(convo(40), 8);
    expect(out.map((m) => m.content)).toEqual(["msg 32", "msg 33", "msg 34", "msg 35", "msg 36", "msg 37", "msg 38", "msg 39"]);
  });
  it("starts the window on a user turn", () => {
    const out = trimHistoryForLocal(convo(40), 7); // would start on an assistant reply
    expect(out[0].role).toBe("user");
    expect(out.at(-1)!.content).toBe("msg 39");
  });
  it("clips very long messages", () => {
    const out = trimHistoryForLocal([{ role: "user", content: "x".repeat(5000) }], 8, 1200);
    expect(out[0].content.length).toBeLessThan(1300);
    expect(out[0].content).toMatch(/\[trimmed\]$/);
  });
});
