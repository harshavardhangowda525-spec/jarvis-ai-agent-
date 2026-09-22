"use client";

import { useCallback, useEffect, useState } from "react";
import { Droplets, Wind, X, Thermometer, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export type WeatherIcon = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "thunder";

export interface WeatherData {
  location: { name: string; country: string; admin: string; timezone: string | null };
  current: { temp: number; feelsLike: number; humidity: number; wind: number; isDay: boolean; condition: string; icon: WeatherIcon };
  daily: { date: string; weekday: string; condition: string; icon: WeatherIcon; tempMax: number; tempMin: number; precip: number }[];
  error?: string;
}

/** Sky gradient per condition + day/night. */
function skyGradient(icon: WeatherIcon, isDay: boolean): string {
  if (!isDay) return "linear-gradient(160deg, #0b1026 0%, #131a3a 55%, #1c2450 100%)";
  switch (icon) {
    case "clear": return "linear-gradient(160deg, #2b6cff 0%, #4aa3ff 55%, #8fd0ff 100%)";
    case "partly": return "linear-gradient(160deg, #3a72d0 0%, #6aa6e6 55%, #a9c9ee 100%)";
    case "cloudy":
    case "fog": return "linear-gradient(160deg, #5b6b86 0%, #7c8aa3 60%, #a7b2c4 100%)";
    case "drizzle":
    case "rain": return "linear-gradient(160deg, #2b3a55 0%, #45566f 60%, #6a7a92 100%)";
    case "snow": return "linear-gradient(160deg, #5f6f8c 0%, #93a3bd 55%, #cdd8e8 100%)";
    case "thunder": return "linear-gradient(160deg, #1c2136 0%, #2c3350 60%, #454d70 100%)";
    default: return "linear-gradient(160deg, #3a72d0, #8fd0ff)";
  }
}

export function WeatherPopup({ data, onClose }: { data: WeatherData; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => { setClosing(true); setTimeout(onClose, 320); }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const loc = [data.location?.name, data.location?.admin && data.location.admin !== data.location?.name ? data.location.admin : "", data.location?.country]
    .filter(Boolean).join(", ");

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-3 sm:p-6"
      style={{ animation: closing ? "dw-scrim-out .3s ease forwards" : "dw-scrim-in .35s ease" }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      {/* liquid-glass card */}
      <div className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-[30px] border border-white/20"
        style={{
          backdropFilter: "blur(24px) saturate(150%)", WebkitBackdropFilter: "blur(24px) saturate(150%)",
          boxShadow: "0 40px 120px -28px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.3), inset 0 0 90px -50px rgba(255,255,255,0.6)",
          animation: closing ? "ev-dissolve .32s ease forwards" : "dw-pop-in .55s cubic-bezier(.2,.9,.25,1.15) both",
        }}>
        {data.error ? (
          <div className="flex flex-col items-center gap-2 bg-[#1c2136] px-6 py-12 text-center">
            <span className="text-3xl">🌫️</span>
            <p className="text-sm text-white/90">Couldn&apos;t get the weather</p>
            <p className="max-w-xs text-[11px] text-white/60">{data.error}</p>
            <button onClick={close} className="mt-2 rounded-full border border-white/25 px-4 py-1.5 text-xs text-white/80 hover:bg-white/10">Close</button>
          </div>
        ) : (
          <>
            {/* ===== animated hero ===== */}
            <div className="relative h-56 overflow-hidden" style={{ background: skyGradient(data.current.icon, data.current.isDay) }}>
              <WeatherScene icon={data.current.icon} isDay={data.current.isDay} />

              {/* close */}
              <button onClick={close} aria-label="Close"
                className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/20 text-white/90 backdrop-blur transition hover:bg-black/40">
                <X className="h-4 w-4" />
              </button>

              {/* location + temp overlay */}
              <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between px-5 pb-4">
                <div>
                  <div className="flex items-center gap-1 text-white/85">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium drop-shadow">{loc || "—"}</span>
                  </div>
                  <div className="text-sm text-white/80 drop-shadow">{data.current.condition}</div>
                </div>
                <div className="text-right leading-none">
                  <div className="text-6xl font-extralight text-white drop-shadow-lg" style={{ animation: "wx-temp-in .7s .15s ease both" }}>
                    {data.current.temp}°
                  </div>
                </div>
              </div>
            </div>

            {/* ===== glass body ===== */}
            <div className="relative flex-1 overflow-y-auto bg-white/[0.06] px-5 py-4" style={{ scrollbarWidth: "thin" }}>
              {/* current stats */}
              <div className="grid grid-cols-3 gap-2">
                <Stat icon={<Thermometer className="h-3.5 w-3.5" />} label="Feels like" value={`${data.current.feelsLike}°`} />
                <Stat icon={<Droplets className="h-3.5 w-3.5" />} label="Humidity" value={`${data.current.humidity}%`} />
                <Stat icon={<Wind className="h-3.5 w-3.5" />} label="Wind" value={`${data.current.wind} km/h`} />
              </div>

              {/* forecast */}
              <div className="mt-4">
                <div className="mb-2 hud-label text-[10px] tracking-[0.28em] text-white/60">6-DAY FORECAST</div>
                <div className="space-y-1">
                  {data.daily.map((d, i) => (
                    <div key={d.date}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2"
                      style={{ opacity: 0, animation: `dw-card-in .5s ${Math.min(i * 0.07, 0.7)}s cubic-bezier(.2,.9,.25,1.1) both` }}>
                      <span className="w-9 text-xs font-medium text-white/85">{i === 0 ? "Today" : d.weekday}</span>
                      <MiniIcon icon={d.icon} />
                      <span className="flex-1 truncate text-[11px] text-white/60">{d.condition}</span>
                      <span className="flex items-center gap-1 text-[10px] text-sky-200">
                        <Droplets className="h-3 w-3" /> {d.precip}%
                      </span>
                      <span className="w-16 text-right text-xs text-white/90">
                        <span className="text-white">{d.tempMax}°</span> <span className="text-white/50">{d.tempMin}°</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="mt-3 text-center text-[9px] text-white/40">Live data · Open-Meteo</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl border border-white/10 bg-white/[0.05] py-2.5">
      <span className="text-white/60">{icon}</span>
      <span className="text-sm text-white/90">{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-white/45">{label}</span>
    </div>
  );
}

/* ===================== animated weather scenes ===================== */
function WeatherScene({ icon, isDay }: { icon: WeatherIcon; isDay: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* night stars */}
      {!isDay && <Stars />}

      {/* sun / moon */}
      {(icon === "clear" || icon === "partly") && (isDay ? <Sun /> : <Moon />)}

      {/* clouds */}
      {(icon === "partly" || icon === "cloudy" || icon === "fog" || icon === "drizzle" || icon === "rain" || icon === "snow" || icon === "thunder") && (
        <Clouds dense={icon === "cloudy" || icon === "rain" || icon === "thunder" || icon === "fog"} />
      )}

      {/* precipitation */}
      {(icon === "rain" || icon === "drizzle") && <Rain heavy={icon === "rain"} />}
      {icon === "snow" && <Snow />}
      {icon === "thunder" && (<><Rain heavy /><Lightning /></>)}
      {icon === "fog" && <Fog />}
    </div>
  );
}

function Sun() {
  return (
    <div className="absolute -right-4 -top-6 h-36 w-36">
      <div className="absolute inset-0" style={{ animation: "wx-spin 40s linear infinite" }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="absolute left-1/2 top-1/2 h-16 w-1 -translate-x-1/2 origin-top rounded-full"
            style={{ transform: `rotate(${i * 30}deg)`, background: "linear-gradient(to bottom, rgba(255,240,180,0.9), transparent)" }} />
        ))}
      </div>
      <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(circle, #fff3b0 0%, #ffd35a 60%, #ffb531 100%)", boxShadow: "0 0 50px 12px rgba(255,211,90,0.65)", animation: "wx-pulse 4s ease-in-out infinite" }} />
    </div>
  );
}

function Moon() {
  return (
    <div className="absolute right-6 top-6 h-16 w-16 rounded-full"
      style={{ background: "radial-gradient(circle at 35% 35%, #fdfdfd, #cfd6e6 70%, #aeb7cc)", boxShadow: "0 0 40px 8px rgba(200,210,235,0.5)", animation: "wx-pulse 6s ease-in-out infinite" }}>
      <span className="absolute left-2 top-3 h-3 w-3 rounded-full bg-black/5" />
      <span className="absolute left-7 top-8 h-2 w-2 rounded-full bg-black/5" />
    </div>
  );
}

function Stars() {
  const stars = Array.from({ length: 26 }, (_, i) => ({ x: (i * 37) % 100, y: (i * 53) % 60, d: 1.5 + ((i * 13) % 30) / 10, delay: (i % 10) * 0.3 }));
  return (
    <div className="absolute inset-0">
      {stars.map((s, i) => (
        <span key={i} className="absolute rounded-full bg-white" style={{ left: `${s.x}%`, top: `${s.y}%`, width: 2, height: 2, animation: `wx-twinkle ${s.d}s ${s.delay}s ease-in-out infinite` }} />
      ))}
    </div>
  );
}

function Clouds({ dense }: { dense: boolean }) {
  const clouds = [
    { top: "12%", scale: 1, dur: 26, delay: 0, op: dense ? 0.95 : 0.85 },
    { top: "34%", scale: 0.7, dur: 34, delay: -8, op: dense ? 0.85 : 0.6 },
    { top: "6%", scale: 0.55, dur: 42, delay: -18, op: dense ? 0.8 : 0.5 },
  ];
  return (
    <>
      {clouds.map((c, i) => (
        <div key={i} className="absolute" style={{ top: c.top, left: "-30%", transform: `scale(${c.scale})`, opacity: c.op, animation: `wx-cloud ${c.dur}s ${c.delay}s linear infinite` }}>
          <Cloud />
        </div>
      ))}
    </>
  );
}
function Cloud() {
  return (
    <svg width="130" height="60" viewBox="0 0 130 60" fill="#ffffff">
      <ellipse cx="40" cy="40" rx="34" ry="20" />
      <ellipse cx="70" cy="34" rx="30" ry="24" />
      <ellipse cx="96" cy="42" rx="26" ry="18" />
      <rect x="30" y="42" width="72" height="16" rx="8" />
    </svg>
  );
}

function Rain({ heavy }: { heavy: boolean }) {
  const drops = Array.from({ length: heavy ? 44 : 22 }, (_, i) => ({ x: (i * 100) / (heavy ? 44 : 22), delay: (i % 12) * 0.13, dur: heavy ? 0.7 : 1.1 }));
  return (
    <div className="absolute inset-0">
      {drops.map((d, i) => (
        <span key={i} className="absolute top-[-10%] w-px" style={{ left: `${d.x}%`, height: 16, background: "linear-gradient(to bottom, transparent, rgba(200,225,255,0.9))", animation: `wx-rain ${d.dur}s ${d.delay}s linear infinite` }} />
      ))}
    </div>
  );
}

function Snow() {
  const flakes = Array.from({ length: 30 }, (_, i) => ({ x: (i * 100) / 30, delay: (i % 15) * 0.4, dur: 3 + (i % 5), size: 2 + (i % 3) }));
  return (
    <div className="absolute inset-0">
      {flakes.map((f, i) => (
        <span key={i} className="absolute top-[-6%] rounded-full bg-white" style={{ left: `${f.x}%`, width: f.size, height: f.size, opacity: 0.9, animation: `wx-snow ${f.dur}s ${f.delay}s linear infinite` }} />
      ))}
    </div>
  );
}

function Lightning() {
  return <div className="absolute inset-0 bg-white" style={{ opacity: 0, animation: "wx-flash 6s 1.5s infinite" }} />;
}

function Fog() {
  return (
    <div className="absolute inset-0">
      {[0, 1, 2].map((i) => (
        <div key={i} className="absolute left-0 h-8 w-[160%]" style={{ top: `${30 + i * 20}%`, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)", animation: `wx-fog ${16 + i * 6}s ${-i * 4}s linear infinite` }} />
      ))}
    </div>
  );
}

function MiniIcon({ icon }: { icon: WeatherIcon }) {
  const map: Record<WeatherIcon, string> = {
    clear: "☀️", partly: "⛅", cloudy: "☁️", fog: "🌫️", drizzle: "🌦️", rain: "🌧️", snow: "❄️", thunder: "⛈️",
  };
  return <span className="w-6 text-center text-base">{map[icon]}</span>;
}
