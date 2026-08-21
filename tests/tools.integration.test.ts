import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { memoryTool } from "@/lib/tools/memory";
import { tasksTool } from "@/lib/tools/tasks";
import { notesTool } from "@/lib/tools/notes";

// These tests exercise the DB-backed tools against a real Postgres. They are
// skipped automatically when DATABASE_URL is not configured/reachable.
const run = isDbConfigured;
const d = run ? describe : describe.skip;

function ctxFor(userId: string) {
  return { userId, timezone: "UTC", activity: () => {} };
}

d("DB-backed tools (integration)", () => {
  let userA = "";
  let userB = "";

  beforeAll(async () => {
    const db = getDb();
    const a = await db.user.create({
      data: { email: `test-a-${Date.now()}@example.com`, passwordHash: "x" },
    });
    const b = await db.user.create({
      data: { email: `test-b-${Date.now()}@example.com`, passwordHash: "x" },
    });
    userA = a.id;
    userB = b.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (userA) await db.user.delete({ where: { id: userA } }).catch(() => {});
    if (userB) await db.user.delete({ where: { id: userB } }).catch(() => {});
  });

  it("stores and recalls a memory", async () => {
    await memoryTool.execute(
      { action: "remember", key: "company", content: "Infinity Web and Apps" },
      ctxFor(userA),
    );
    const recalled: any = await memoryTool.execute({ action: "recall" }, ctxFor(userA));
    const found = recalled.data.memories.some((m: any) =>
      m.content.includes("Infinity Web and Apps"),
    );
    expect(found).toBe(true);
  });

  it("refuses to store secrets in memory", async () => {
    await expect(
      memoryTool.execute(
        { action: "remember", content: "my password is hunter2" },
        ctxFor(userA),
      ),
    ).rejects.toThrow(/secret|password/i);
  });

  it("creates, lists, completes and deletes a task", async () => {
    const created: any = await tasksTool.execute(
      { action: "create", title: "Call the client" },
      ctxFor(userA),
    );
    const id = created.data.id;
    expect(id).toBeTruthy();

    const listed: any = await tasksTool.execute({ action: "list" }, ctxFor(userA));
    expect(listed.data.tasks.some((t: any) => t.id === id)).toBe(true);

    await tasksTool.execute({ action: "complete", id }, ctxFor(userA));
    const afterComplete: any = await tasksTool.execute({ action: "list" }, ctxFor(userA));
    expect(afterComplete.data.tasks.some((t: any) => t.id === id)).toBe(false);

    await tasksTool.execute({ action: "delete", id }, ctxFor(userA));
  });

  it("creates and retrieves a note", async () => {
    const created: any = await notesTool.execute(
      { action: "create", content: "Business idea: AI concierge" },
      ctxFor(userA),
    );
    const got: any = await notesTool.execute(
      { action: "get", id: created.data.id },
      ctxFor(userA),
    );
    expect(got.data.content).toContain("AI concierge");
  });

  it("enforces per-user isolation", async () => {
    // A task created by user A must not be visible to user B.
    const created: any = await tasksTool.execute(
      { action: "create", title: "Private to A" },
      ctxFor(userA),
    );
    const bList: any = await tasksTool.execute({ action: "list" }, ctxFor(userB));
    expect(bList.data.tasks.some((t: any) => t.id === created.data.id)).toBe(false);

    // B cannot complete or delete A's task.
    await expect(
      tasksTool.execute({ action: "complete", id: created.data.id }, ctxFor(userB)),
    ).rejects.toThrow();
  });
});
