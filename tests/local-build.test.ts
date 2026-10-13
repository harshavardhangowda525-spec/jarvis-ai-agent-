import { describe, expect, it } from "vitest";

describe("prismaClientMatches", () => {
  it("treats Prisma's reformatted copy as the same schema", async () => {
    const { prismaClientMatches } = await import("../scripts/local-helpers.mjs");
    expect(prismaClientMatches("model A {\n  id String @id\n}\n", "model A {\r\n  id   String  @id\r\n}")).toBe(true);
    expect(prismaClientMatches("model A {\n  id String @id\n}", "model A {\n  id Int @id\n}")).toBe(false);
    expect(prismaClientMatches("model A {}", "")).toBe(false);
  });
});
