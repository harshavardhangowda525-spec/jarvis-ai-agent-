import { describe, it, expect } from "vitest";
import { trimHistoryForLocal, type ChatTurn } from "@/lib/ai/history";

const convo = (n: number, from = 0): ChatTurn[] =>
  Array.from({ length: n }, (_, i) => ({ role: (i + from) % 2 === 0 ? "user" : "assistant", content: `msg ${i + from}` }));

describe("trimHistoryForLocal", () => {
  it("keeps only recent messages, never more than the limit", () => {
    const out = trimHistoryForLocal(convo(40), 8);
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out.at(-1)!.content).toBe("msg 39");
    expect(out[0].role).toBe("user");
  });

  it("moves the window start in steps so the prompt start stays cache-friendly", () => {
    // Each turn adds 2 messages. The first kept message should change only every few turns.
    const starts = [12, 14, 16, 18, 20, 22, 24].map((n) => trimHistoryForLocal(convo(n), 8)[0].content);
    expect(starts).toEqual(["msg 6", "msg 6", "msg 12", "msg 12", "msg 12", "msg 18", "msg 18"]);
  });

  it("uses the conversation's real length when only its tail was loaded", () => {
    // 100-message conversation, route loaded the last 40 (messages 60..99)
    const tail = convo(40, 60);
    const a = trimHistoryForLocal(tail, 8, 1200, 100);
    const b = trimHistoryForLocal(convo(40, 62), 8, 1200, 102); // one turn later
    expect(a[0].content).toBe(b[0].content);
    expect(a.at(-1)!.content).toBe("msg 99");
  });

  it("starts the window on a user turn", () => {
    const out = trimHistoryForLocal(convo(40), 7);
    expect(out[0].role).toBe("user");
    expect(out.at(-1)!.content).toBe("msg 39");
  });

  it("clips very long messages", () => {
    const out = trimHistoryForLocal([{ role: "user", content: "x".repeat(5000) }], 8, 1200);
    expect(out[0].content.length).toBeLessThan(1300);
    expect(out[0].content).toMatch(/\[trimmed\]$/);
  });
});
