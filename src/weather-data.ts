import { requestUrl } from "obsidian";
import type { LifeAdminSettings } from "./settings";
import { clamp01, lerp } from "./utils";

export interface VisualCrossingDay {
  tempmax?: number;
  tempmin?: number;
  precipprob?: number;
  precip?: number;
  windspeed?: number;
  windgust?: number;
  conditions?: string;
  description?: string;
  icon?: string;
}

export interface WeatherDisplay {
  status: "ok" | "error" | "loading";
  hi: number | null;
  lo: number | null;
  description: string;
  highlights: string | null;
  conditions: string | null;
  icon: string | null;
  rain: number | null;
  precipMm: number | null;
  windKph: number | null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
}

export function tempToColor(t: number): string {
  const CYAN = "#00ffff";
  const BLUE = "#0000ff";
  const YELL = "#ffff00";
  const RED = "#ff0000";
  const mix = (a: string, b: string, tt: number): string => {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return rgbToHex({ r: lerp(A.r, B.r, tt), g: lerp(A.g, B.g, tt), b: lerp(A.b, B.b, tt) });
  };
  if (t <= -1) return CYAN;
  if (t >= 40) return RED;
  if (t <= 10) return mix(CYAN, BLUE, clamp01((t + 1) / 11));
  if (t <= 30) return mix(BLUE, YELL, clamp01((t - 10) / 20));
  return mix(YELL, RED, clamp01((t - 30) / 10));
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function includesAny(text: string, needles: string[]): boolean {
  const hay = text.toLowerCase();
  return needles.some((n) => hay.includes(n));
}

export function buildWeatherHighlights(day: VisualCrossingDay): string | null {
  const parts: string[] = [];
  const rain = day.precipprob;
  const precip = day.precip;
  const wind = day.windspeed;
  const gust = day.windgust;

  if (Number.isFinite(rain) && rain >= 40) parts.push(`${Math.round(rain)}% chance of rain`);
  else if (Number.isFinite(rain) && rain >= 15) parts.push(`${Math.round(rain)}% rain chance`);

  if (Number.isFinite(precip) && precip >= 0.2) parts.push(`${Number(precip.toFixed(1))} mm expected`);

  if (Number.isFinite(gust) && gust >= 45) parts.push(`Gusts to ${Math.round(gust)} km/h`);
  else if (Number.isFinite(wind) && wind >= 30) parts.push(`Wind ${Math.round(wind)} km/h`);
  else if (Number.isFinite(wind) && wind >= 20) parts.push(`Breezy (${Math.round(wind)} km/h)`);

  return parts.length ? parts.join(" · ") : null;
}

export function weatherDescription(day: VisualCrossingDay): string {
  const description = String(day.description ?? "").trim();
  if (description) return description;

  const conditions = String(day.conditions ?? "").trim();
  if (conditions) return conditions;

  const bits: string[] = [];
  if (Number.isFinite(day.precipprob) && day.precipprob >= 30) bits.push("Wet weather likely");
  else if (Number.isFinite(day.precipprob) && day.precipprob >= 10) bits.push("Some rain possible");
  else bits.push("Mostly dry");

  if (Number.isFinite(day.windspeed) && day.windspeed >= 25) bits.push("windy");
  return bits.join(", ");
}

function filterHighlightsAgainstDescription(description: string, highlights: string | null): string | null {
  if (!highlights) return null;
  const chunks = highlights.split(" · ").filter(Boolean);
  const filtered = chunks.filter((chunk) => {
    const lower = chunk.toLowerCase();
    if (lower.includes("rain") && includesAny(description, ["rain", "shower", "drizzle", "wet"])) return false;
    if (lower.includes("wind") && includesAny(description, ["wind", "breezy", "gust"])) return false;
    if (lower.includes("mm") && includesAny(description, ["mm", "precip", "snow", "sleet"])) return false;
    return true;
  });
  return filtered.length ? filtered.join(" · ") : null;
}

export function weatherDisplayFromDay(day: VisualCrossingDay | null | undefined): WeatherDisplay {
  if (!day) {
    return {
      status: "error",
      hi: null,
      lo: null,
      description: "",
      highlights: null,
      conditions: null,
      icon: null,
      rain: null,
      precipMm: null,
      windKph: null,
    };
  }

  const hi = Number.isFinite(day.tempmax) ? Math.ceil(day.tempmax) : null;
  const lo = Number.isFinite(day.tempmin) ? Math.floor(day.tempmin) : null;
  const rain = Number.isFinite(day.precipprob) ? Math.floor(day.precipprob) : null;
  const precipMm = Number.isFinite(day.precip) ? Number(day.precip.toFixed(1)) : null;
  const windKph = Number.isFinite(day.windspeed) ? Math.round(day.windspeed) : null;
  const description = weatherDescription(day);
  const highlights = filterHighlightsAgainstDescription(description, buildWeatherHighlights(day));

  return {
    status: hi !== null && lo !== null ? "ok" : "error",
    hi,
    lo,
    description,
    highlights,
    conditions: day.conditions ?? null,
    icon: day.icon ?? null,
    rain,
    precipMm,
    windKph,
  };
}

export async function fetchWeatherForDate(
  settings: LifeAdminSettings,
  dateYmd: string,
): Promise<WeatherDisplay> {
  const key = settings.weatherApiKey.trim();
  const location = settings.weatherLocation.trim();
  if (!key || !location) throw new Error("Missing weather settings");

  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(
    location,
  )}/${encodeURIComponent(dateYmd)}?unitGroup=metric&include=days&key=${encodeURIComponent(key)}&contentType=json&lang=en`;

  const res = await requestUrl({ url });
  const day = res.json?.days?.[0] as VisualCrossingDay | undefined;
  return weatherDisplayFromDay(day);
}

export function buildWeatherWidgetHtml(display: WeatherDisplay): string {
  const attrs = 'class="dashboard-widget dashboard-weather" data-widget="weather" data-action="weather-click"';

  if (display.status === "loading") {
    return `<div class="dashboard-widget dashboard-weather" data-widget="weather" data-loading="true">
  <div class="dashboard-weather-bar dashboard-weather-bar--loading" data-action="refresh" data-widget="weather" role="button" tabindex="0">Loading weather… — tap to refresh</div>
</div>`;
  }

  if (display.status === "error") {
    return `<div ${attrs}>
  <div class="dashboard-weather-bar dashboard-weather-bar--error">Weather unavailable — tap to open forecast</div>
</div>`;
  }

  const hiColor = tempToColor(display.hi ?? 0);
  const loColor = tempToColor(display.lo ?? 0);
  const temp = `<span class="dashboard-weather-hi" style="color:${hiColor};font-weight:700;">${display.hi}</span><span class="dashboard-weather-sep">–</span><span class="dashboard-weather-lo" style="color:${loColor};font-weight:700;">${display.lo}</span><span class="dashboard-weather-unit">°C</span>`;
  const highlights = display.highlights
    ? `<div class="dashboard-weather-highlights">${escapeHtml(display.highlights)}</div>`
    : "";

  return `<div ${attrs}>
  <div class="dashboard-weather-bar">
    <div class="dashboard-weather-temp">${temp}</div>
    <div class="dashboard-weather-body">
      <div class="dashboard-weather-description">${escapeHtml(display.description)}</div>
      ${highlights}
    </div>
  </div>
</div>`;
}
