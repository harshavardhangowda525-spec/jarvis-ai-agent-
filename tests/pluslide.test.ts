import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

/**
 * Verifies the Pluslide tool builds exactly the request the documented API
 * expects: POST {base}/v1/project/export with Bearer auth and a body of
 * { projectId, presentation: { slideList } }. Uses a mocked fetch — no network
 * and no real API key required.
 */

// Must be set BEFORE env.ts is imported (it reads process.env at module load),
// so the tool is pulled in via dynamic import inside the tests.
beforeAll(() => {
  process.env.PLUSLIDE_API_KEY = "test_key_123";
  process.env.PLUSLIDE_PROJECT_ID = "proj-abc";
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ctx = { userId: "u1", timezone: "UTC", activity: () => {} };

const titleSlide = {
  templateKey: "business-report-title",
  content: { staticTitle: "BUSINESS REPORT", reportTitle: "Q3 2026 Performance", reportDate: "September 2026" },
};

describe("pluslide tool", () => {
  it("posts the documented export request and returns the result link", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ url: "https://pluslide.com/p/xyz" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { pluslideTool } = await import("@/lib/tools/pluslide");
    const res = await pluslideTool.execute({ slideList: [titleSlide] }, ctx);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    // Correct endpoint + method.
    expect(url).toBe("https://api.pluslide.com/v1/project/export");
    expect(init.method).toBe("POST");
    // Bearer auth from the API key.
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test_key_123");
    // Body matches the documented shape.
    const body = JSON.parse(init.body as string);
    expect(body.projectId).toBe("proj-abc");
    expect(body.presentation.slideList).toHaveLength(1);
    expect(body.presentation.slideList[0].templateKey).toBe("business-report-title");
    expect(body.presentation.slideList[0].content.reportTitle).toBe("Q3 2026 Performance");
    // Result surfaces the link for JARVIS to open.
    expect((res.data as any).openUrl).toBe("https://pluslide.com/p/xyz");
    expect(res.summary).toMatch(/presentation/i);
  });

  it("gives a clear error on 401 (bad key)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 }));
    const { pluslideTool } = await import("@/lib/tools/pluslide");
    await expect(pluslideTool.execute({ slideList: [titleSlide] }, ctx)).rejects.toThrow(/rejected the API key/i);
  });

  it("gives actionable guidance on 404 (wrong project/path)", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    const { pluslideTool } = await import("@/lib/tools/pluslide");
    await expect(pluslideTool.execute({ slideList: [titleSlide] }, ctx)).rejects.toThrow(/404/);
  });
});
