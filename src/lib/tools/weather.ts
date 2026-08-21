import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { env } from "@/lib/env";

const schema = z.object({
  location: z
    .string()
    .min(1)
    .max(120)
    .describe("City name, optionally with country code, e.g. 'London,GB'."),
});

export const weatherTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "get_weather",
  description:
    "Get the current weather for a location (temperature, conditions, humidity, " +
    "wind). Use when the user asks about weather.",
  schema,
  requiresCapability: "weather",
  inputSchema: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "City name, optionally 'City,CC' with ISO country code.",
      },
    },
    required: ["location"],
  },
  activityLabel: "Checking the weather",
  async execute({ location }) {
    if (!env.weatherApiKey) {
      throw new ToolError("Weather is not configured.");
    }
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("q", location);
    url.searchParams.set("appid", env.weatherApiKey);
    url.searchParams.set("units", "metric");

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new ToolError("The weather service is unreachable right now.");
    }
    if (res.status === 404) throw new ToolError(`I couldn't find "${location}".`);
    if (!res.ok) throw new ToolError("The weather service returned an error.");

    const j: any = await res.json();
    const data = {
      location: `${j.name}${j.sys?.country ? ", " + j.sys.country : ""}`,
      description: j.weather?.[0]?.description ?? "unknown",
      tempC: Math.round(j.main?.temp),
      feelsLikeC: Math.round(j.main?.feels_like),
      humidity: j.main?.humidity,
      windKph: Math.round((j.wind?.speed ?? 0) * 3.6),
    };
    return {
      data,
      summary: `${data.location}: ${data.tempC}°C, ${data.description}.`,
    };
  },
};
