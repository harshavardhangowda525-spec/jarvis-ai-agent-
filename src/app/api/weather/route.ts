import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real weather + forecast via Open-Meteo — FREE, no API key. Geocodes a place
 * name (or takes lat/lon), then returns current conditions and a 6-day forecast.
 * Powers JARVIS's liquid-glass weather popup.
 */

// WMO weather code → { condition label, icon category }.
function decodeWeather(code: number): { condition: string; icon: WeatherIcon } {
  if (code === 0) return { condition: "Clear sky", icon: "clear" };
  if (code === 1) return { condition: "Mainly clear", icon: "clear" };
  if (code === 2) return { condition: "Partly cloudy", icon: "partly" };
  if (code === 3) return { condition: "Overcast", icon: "cloudy" };
  if (code === 45 || code === 48) return { condition: "Fog", icon: "fog" };
  if (code >= 51 && code <= 57) return { condition: "Drizzle", icon: "drizzle" };
  if (code >= 61 && code <= 67) return { condition: "Rain", icon: "rain" };
  if (code >= 71 && code <= 77) return { condition: "Snow", icon: "snow" };
  if (code >= 80 && code <= 82) return { condition: "Rain showers", icon: "rain" };
  if (code === 85 || code === 86) return { condition: "Snow showers", icon: "snow" };
  if (code >= 95) return { condition: "Thunderstorm", icon: "thunder" };
  return { condition: "Unknown", icon: "cloudy" };
}

export type WeatherIcon = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "thunder";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`weather:${user.id}`, 30, 60_000);
    if (!rl.allowed) return fail("Too many weather requests — wait a moment.", 429);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    let lat = parseFloat(searchParams.get("lat") || "");
    let lon = parseFloat(searchParams.get("lon") || "");
    let name = q || "Current location";
    let country = "";
    let admin = "";

    // Geocode a place name when no coordinates were provided.
    if ((isNaN(lat) || isNaN(lon)) && q) {
      const gRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) },
      ).catch(() => null);
      const gJson: any = gRes && gRes.ok ? await gRes.json().catch(() => ({})) : {};
      const hit = gJson?.results?.[0];
      if (!hit) return fail(`I couldn't find "${q}". Try a city name like "London" or "Bengaluru".`, 404);
      lat = hit.latitude; lon = hit.longitude; name = hit.name;
      country = hit.country || ""; admin = hit.admin1 || "";
    }

    if (isNaN(lat) || isNaN(lon)) return fail("Provide a place name (?q=London) or coordinates (?lat=&lon=).", 400);

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&forecast_days=6`;
    const wRes = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) }).catch(() => null);
    if (!wRes || !wRes.ok) return fail("Couldn't reach the weather service. Try again in a moment.", 502);
    const w: any = await wRes.json().catch(() => ({}));

    const cur = w.current ?? {};
    const curDecoded = decodeWeather(Number(cur.weather_code));
    const d = w.daily ?? {};
    const days = Array.isArray(d.time) ? d.time : [];
    const daily = days.map((iso: string, i: number) => {
      const dec = decodeWeather(Number(d.weather_code?.[i]));
      const date = new Date(iso + "T00:00:00");
      return {
        date: iso,
        weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
        condition: dec.condition,
        icon: dec.icon,
        tempMax: Math.round(Number(d.temperature_2m_max?.[i])),
        tempMin: Math.round(Number(d.temperature_2m_min?.[i])),
        precip: Number(d.precipitation_probability_max?.[i] ?? 0),
      };
    });

    return ok({
      location: { name, country, admin, latitude: lat, longitude: lon, timezone: w.timezone ?? null },
      current: {
        temp: Math.round(Number(cur.temperature_2m)),
        feelsLike: Math.round(Number(cur.apparent_temperature)),
        humidity: Math.round(Number(cur.relative_humidity_2m)),
        wind: Math.round(Number(cur.wind_speed_10m)),
        isDay: Number(cur.is_day) === 1,
        code: Number(cur.weather_code),
        condition: curDecoded.condition,
        icon: curDecoded.icon,
      },
      daily,
    });
  } catch (err) {
    return handleError(err);
  }
}
