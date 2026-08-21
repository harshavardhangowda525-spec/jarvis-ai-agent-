import { describe, it, expect } from "vitest";
import { availableTools, getTool, toolCatalog } from "@/lib/tools/registry";

describe("tool registry", () => {
  it("always exposes the capability-free core tools", () => {
    const names = availableTools().map((t) => t.name);
    for (const core of ["calculator", "get_time", "memory", "tasks", "notes", "navigate"]) {
      expect(names).toContain(core);
    }
  });

  it("gates web_search and get_weather behind their capabilities", () => {
    const names = availableTools().map((t) => t.name);
    // In the test env SEARCH_API_KEY / WEATHER_API_KEY are typically empty.
    const catalog = toolCatalog();
    const search = catalog.find((t) => t.name === "web_search")!;
    const weather = catalog.find((t) => t.name === "get_weather")!;
    expect(search.requiresCapability).toBe("search");
    expect(weather.requiresCapability).toBe("weather");
    if (!process.env.SEARCH_API_KEY) expect(names).not.toContain("web_search");
    if (!process.env.WEATHER_API_KEY) expect(names).not.toContain("get_weather");
  });

  it("every tool has a valid JSON input schema and getTool works", () => {
    for (const t of toolCatalog()) {
      const tool = getTool(t.name)!;
      expect(tool).toBeDefined();
      expect(tool.inputSchema).toHaveProperty("type", "object");
      expect(tool.inputSchema).toHaveProperty("properties");
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("returns undefined for unknown tools", () => {
    expect(getTool("does_not_exist")).toBeUndefined();
  });
});
