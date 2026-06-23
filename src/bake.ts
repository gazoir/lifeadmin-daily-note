import { App, TFile } from "obsidian";
import {
  eventCalendarColor,
  eventTitle,
  fetchCalendarEventsForDay,
  formatEventTime,
  hexWithAlpha,
  isGoogleCalendarAuthError,
  isGoogleCalendarAuthenticated,
  type GCalEvent,
} from "./gcal-events";
import { parseHevyWorkoutsFromMarkdown, type HevyLogEntry } from "./hevy-log";
import { shouldDeferNetworkBakes } from "./bake-mode";
import { DAILY_NOTE_PATH_RE, shouldWriteBakeFrontmatter } from "./daily-notes";
import { collectDueHabits, HABITS_EMPTY_HTML } from "./habits";
import {
  buildWeatherWidgetHtml,
  fetchWeatherForDate,
  type WeatherDisplay,
} from "./weather-data";
import {
  bodyFatDisplayColor,
  displayBodyFat,
  meanDisplayBf,
  needsGymCalibrationReminder,
  parseWeightEntries,
  weightDisplayColor,
} from "./weight-data";
import type { LifeAdminSettings } from "./settings";
import {
  computeTrackProgress,
  readGbOnlineData,
  referenceDateForNote,
  resolveGbWeekContext,
  isSundayYmd,
} from "./gb-online-data";
import { buildGbOnlineWidgetHtml } from "./gb-online-widget";
import {
  computeDailyProgress,
  readDailyLayoutForWeek,
  readDailyPlaylistOpen,
  readDailyOpenSeries,
  readDailyWidgetExpanded,
  syncGbWeekIfUnsynced,
} from "./gb-online-daily";
import { buildGbOnlineDailyWidgetHtml } from "./gb-online-daily-widget";
import { resolveGbLogoUrl } from "./gb-logo";
import {
  BakeContext,
  clamp,
  escapeAttr,
  fmt,
  formatYmd,
  lerp,
  numFrom,
  pad2,
  stripFrontmatter,
  wrapWidget,
} from "./utils";

const COLOR_YESTERDAY = "#627ac7";
const COLOR_7DAYS = "#c76276";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function resolveNoteDate(ctx: BakeContext): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ctx.noteDate) ? ctx.noteDate : formatYmd(new Date());
}

function parseYmdFromFilename(name: string): Date | null {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function ymdUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

function toUTCDateFromISO(iso: unknown): Date | null {
  const d = new Date(String(iso ?? ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstEmoji(name: unknown): string {
  const chars = Array.from(String(name ?? "").trim());
  return chars[0] ?? "";
}

interface HevyDayWorkout {
  time: string;
  name: string;
}

function hevyWorkoutsByDay(workouts: unknown): Map<string, HevyDayWorkout[]> {
  const byDay = new Map<string, HevyDayWorkout[]>();
  if (!Array.isArray(workouts)) return byDay;

  for (const raw of workouts as Array<Record<string, unknown>>) {
    const id = String(raw?.id ?? "");
    if (/^temp-/i.test(id)) continue;
    const d = toUTCDateFromISO(raw?.time);
    if (!d) continue;
    const key = ymdUTC(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
    const entry: HevyDayWorkout = {
      time: String(raw.time ?? ""),
      name: String(raw.name ?? ""),
    };
    const list = byDay.get(key) ?? [];
    list.push(entry);
    byDay.set(key, list);
  }

  for (const list of byDay.values()) {
    list.sort((a, b) => (toUTCDateFromISO(b.time)?.getTime() ?? 0) - (toUTCDateFromISO(a.time)?.getTime() ?? 0));
  }
  return byDay;
}

function hevyEmojiStackLayout(count: number, index: number): { x: number; y: number; z: number; opacity: number } {
  if (count === 1) {
    return { x: 0, y: 2, z: 2, opacity: 1 };
  }
  if (count === 2) {
    if (index === 0) return { x: -4, y: 0, z: 2, opacity: 1 };
    return { x: 4, y: 5, z: 1, opacity: 0.68 };
  }
  // 3+ — newest centred; older tucked behind
  if (index === 0) return { x: 0, y: 2, z: 3, opacity: 1 };
  if (index === 1) return { x: -5, y: 6, z: 2, opacity: 0.72 };
  return { x: 5, y: 7, z: 1, opacity: 0.55 };
}

function buildHevyEmojiStack(workouts: HevyDayWorkout[]): string {
  const visible = workouts.slice(0, 3);
  if (!visible.length) return "";

  const layers: string[] = [];
  for (let i = visible.length - 1; i >= 0; i--) {
    const w = visible[i];
    const layout = hevyEmojiStackLayout(visible.length, i);
    const emoji = firstEmoji(w.name) || "🏋️";
    layers.push(
      `<span style="position:absolute;left:50%;top:50%;transform:translate(calc(-50% + ${layout.x}px), calc(-50% + ${layout.y}px));font-size:17px;line-height:1;z-index:${layout.z};opacity:${layout.opacity};pointer-events:none;">${emoji}</span>`,
    );
  }

  return `<div style="position:relative;width:30px;height:26px;">${layers.join("")}</div>`;
}

function buildHevyDayButton(day: Date, key: string, workouts: HevyDayWorkout[]): string {
  const hasWorkouts = workouts.length > 0;
  const labelOpacity = hasWorkouts ? 0.2 : 0.48;
  const title = hasWorkouts
    ? workouts.map((w) => `${key} — ${w.name}`).join(" | ")
    : `${key} — log a workout`;

  const emojiHtml = hasWorkouts ? buildHevyEmojiStack(workouts) : "";

  return `<button type="button" class="dashboard-hevy-day" data-action="hevy-create" data-date="${key}" title="${escapeAttr(
    title,
  )}" style="position:relative;display:inline-block;width:46px;height:50px;padding:0;border:1px solid var(--background-modifier-border);border-radius:0;background:var(--background-secondary);cursor:pointer;overflow:visible;flex-shrink:0;">
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-size:8px;line-height:1.2;color:var(--text-muted);opacity:${labelOpacity};pointer-events:none;">
    <div style="font-weight:500;letter-spacing:0.02em;">${DOW[day.getUTCDay()]}</div>
    <div style="font-size:9px;margin-top:1px;">${day.getUTCDate()}</div>
  </div>
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">${emojiHtml}</div>
</button>`;
}

function lastN<T>(arr: T[], n: number): T[] {
  return arr.slice(Math.max(0, arr.length - n));
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN;
}

function stdev(arr: number[]): number {
  if (!arr || arr.length < 2) return NaN;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function colorFromT(t: number): string {
  return `hsl(${120 * (1 - clamp(t, 0, 1))}, 80%, 45%)`;
}

function colorByZ(value: number, target: number, sd: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(target) || !Number.isFinite(sd) || sd === 0) {
    return "var(--text-normal)";
  }
  return colorFromT(clamp(Math.abs(value - target) / sd / 2, 0, 1));
}

function normalizeYmd(v: unknown): string | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  if (typeof v === "object" && v !== null && "toISODate" in v) {
    const fn = (v as { toISODate?: () => string }).toISODate;
    if (typeof fn === "function") return fn();
  }
  return null;
}

function diffDays(a: string, b: string): number {
  const da = parseYmdFromFilename(a);
  const db = parseYmdFromFilename(b);
  if (!da || !db) return 0;
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

function addDays(ymd: string, days: number): string {
  const d = parseYmdFromFilename(ymd);
  if (!d) return ymd;
  const out = addDaysUTC(d, days);
  return ymdUTC(out);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
}

function lerpColor(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex({ r: Math.round(lerp(A.r, B.r, t)), g: Math.round(lerp(A.g, B.g, t)), b: Math.round(lerp(A.b, B.b, t)) });
}

function colorForOverdueDays(overdueDays: number): string | null {
  if (overdueDays <= 0) return null;
  if (overdueDays >= 7) return COLOR_7DAYS;
  return lerpColor(COLOR_YESTERDAY, COLOR_7DAYS, (overdueDays - 1) / 6);
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const GCAL_EVENTS_TABLE_STYLE =
  "width:100%;border-collapse:separate;border-spacing:0 3px;margin:0;border:none;font-size:var(--font-ui-small)";
const GCAL_NAV_BTN =
  "flex:1 1 33.333%;min-width:0;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;padding:4px 6px;text-align:center;white-space:nowrap;line-height:1.2;font-size:var(--font-ui-small);text-decoration:none;color:var(--text-normal);background:var(--background-secondary);border:1px solid var(--background-modifier-border);cursor:pointer;touch-action:manipulation;appearance:none;-webkit-appearance:none;font-family:inherit;";


function buildGcalNavBar(dateYmd: string): string {
  const prevDate = addDays(dateYmd, -1);
  const nextDate = addDays(dateYmd, 1);
  return `<div class="dashboard-gcal-nav" style="display:flex;flex-wrap:nowrap;width:100%;margin:0 0 3px 0;padding:0;gap:0">
  <button type="button" class="dashboard-gcal-nav-btn" data-action="daily-diary-open" data-date="${escapeAttr(prevDate)}" style="${GCAL_NAV_BTN}border-right:none;border-radius:0">⬅️ Previous</button>
  <button type="button" class="dashboard-gcal-nav-btn" data-action="daily-diary-open" data-date="${escapeAttr(nextDate)}" style="${GCAL_NAV_BTN}border-right:none;border-radius:0">Next ➡️</button>
  <a class="internal-link dashboard-gcal-nav-btn" data-href="Ten Day Planner" href="Ten Day Planner" style="${GCAL_NAV_BTN}border-radius:0">Ten Day 🗓️</a>
</div>`;
}

function buildGcalWidgetInner(dateYmd: string, eventRows: string): string {
  return `${buildGcalNavBar(dateYmd)}
<table class="dashboard-gcal-events-table" style="${GCAL_EVENTS_TABLE_STYLE}"><tbody>
${eventRows}
</tbody></table>`;
}

function buildGcalAuthPrompt(dateYmd: string): string {
  const body = `<tr><td colspan="2" style="padding:6px 0;text-align:center;border:none">
    <button type="button" data-action="gcal-auth-open" style="cursor:pointer;padding:6px 12px;border-radius:0;border:1px solid var(--background-modifier-border);background:var(--background-secondary);">Connect Google Calendar</button>
  </td></tr>`;
  return `<div class="dashboard-widget dashboard-gcal" data-widget="gcal" data-date="${escapeAttr(dateYmd)}" style="touch-action:pan-y;margin:0;padding:0">
  ${buildGcalWidgetInner(dateYmd, body)}
</div>`;
}

function buildGcalEventRows(events: GCalEvent[]): string {
  if (!events.length) {
    return `<tr><td colspan="2" style="opacity:0.55;text-align:center;padding:4px 0;border:none">No events</td></tr>`;
  }

  let rows = "";
  for (const event of events) {
    const color = eventCalendarColor(event);
    const bg = hexWithAlpha(color, 0.22);
    const time = escapeHtml(formatEventTime(event));
    const title = escapeHtml(eventTitle(event) || "Untitled");
    const calendarId = escapeAttr(event.parent?.id ?? "");
    rows += `<tr class="dashboard-gcal-event">
  <td class="dashboard-gcal-time" style="width:1%;padding:4px 4px;vertical-align:middle;text-align:center;white-space:nowrap;background:${bg};border:none;border-left:4px solid ${color}">
    <button type="button" class="dashboard-gcal-open" data-action="gcal-event-open" data-event-id="${escapeAttr(event.id)}" data-calendar-id="${calendarId}" title="Open event" style="display:block;width:100%;margin:0;padding:0;border:none;background:transparent;box-shadow:none;appearance:none;-webkit-appearance:none;color:var(--text-normal);font-family:var(--font-monospace,monospace);font-size:0.88em;line-height:1.2;text-align:center;text-decoration:none;cursor:pointer;touch-action:manipulation;">${time}</button>
  </td>
  <td class="dashboard-gcal-title" style="padding:4px 8px;vertical-align:middle;background:${bg};color:var(--text-normal);border:none">${title}</td>
</tr>`;
  }
  return rows;
}

export class DashboardBaker {
  constructor(
    private readonly app: App,
    private readonly settings: LifeAdminSettings,
    private readonly pluginDir: string,
  ) {}

  gbLogoUrl(): string {
    return resolveGbLogoUrl(this.app, this.settings, this.pluginDir);
  }

  async bakeWeather(ctx: BakeContext): Promise<string> {
    const noteDate = resolveNoteDate(ctx);
    let display: WeatherDisplay = {
      status: "loading",
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

    if (shouldDeferNetworkBakes()) {
      return wrapWidget("weather", buildWeatherWidgetHtml(display));
    }

    try {
      display = await fetchWeatherForDate(this.settings, noteDate);
    } catch {
      display = {
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

    if (ctx.file instanceof TFile && (await shouldWriteBakeFrontmatter(this.app, ctx.file))) {
      await this.app.fileManager.processFrontMatter(ctx.file, (fm) => {
        if (display.status === "ok") {
          fm.highTemp = display.hi ?? "Error";
          fm.lowTemp = display.lo ?? "Error";
          fm.rainChance = display.rain !== null ? `${display.rain}%` : "Error";
          fm.conditions = display.conditions ?? display.description ?? "Unknown";
          fm.weatherDescription = display.description;
          fm.icon = display.icon ?? "unknown";
          fm.precipMm = display.precipMm ?? "—";
          fm.windKph = display.windKph ?? "—";
          fm.weatherStatus = "ok";
        } else {
          fm.weatherStatus = "error";
        }
        fm.weatherUpdated = new Date().toISOString();
      });
    }

    return wrapWidget("weather", buildWeatherWidgetHtml(display));
  }

  async bakeHevy(ctx: BakeContext): Promise<string> {
    const noteDate = resolveNoteDate(ctx);
    let base = parseYmdFromFilename(noteDate);
    if (!base) {
      const now = new Date();
      base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    }

    const logFile = this.app.vault.getAbstractFileByPath(this.settings.hevyLogPath);
    let workouts: HevyLogEntry[] | undefined;
    if (logFile instanceof TFile) {
      const md = await this.app.vault.read(logFile);
      workouts = parseHevyWorkoutsFromMarkdown(md);
    }
    const byDay = hevyWorkoutsByDay(workouts);

    let buttons = "";
    for (let i = 6; i >= 0; i--) {
      const day = addDaysUTC(base, -i);
      const key = ymdUTC(day);
      buttons += buildHevyDayButton(day, key, byDay.get(key) ?? []);
    }

    const html = `<div class="dashboard-widget dashboard-hevy" data-widget="hevy" style="display:flex;justify-content:center;width:100%;">
  <div class="hevy-7day" style="display:inline-flex;gap:6px;align-items:center;">
    ${buttons}
  </div>
</div>`;
    return wrapWidget("hevy", html);
  }

  async bakeWeight(ctx: BakeContext): Promise<string> {
    const noteDate = resolveNoteDate(ctx);
    const weightFile = this.app.vault.getAbstractFileByPath(this.settings.weightDataPath);

    let innerHtml = `<span style="opacity:0.7;">no data</span>`;
    let bg = "var(--background-secondary)";
    let textColor = "var(--text-normal)";
    let hasToday = false;
    let weightLogged = false;

    if (ctx.file instanceof TFile) {
      const fm = this.app.metadataCache.getFileCache(ctx.file)?.frontmatter ?? {};
      const wl = (fm as Record<string, unknown>).Weight_Logged;
      weightLogged = wl === true || String(wl ?? "").toLowerCase() === "true";
    }

    if (weightFile instanceof TFile) {
      const rawFull = await this.app.vault.read(weightFile);
      const entries = parseWeightEntries(rawFull);
      const gymStale = needsGymCalibrationReminder(noteDate, entries);

      const todays = entries.filter((e) => e.dateStr === noteDate);
      hasToday = todays.length > 0;
      const todayEntry = hasToday ? todays[todays.length - 1] : null;
      const w7 = lastN(entries, 7);

      if (!hasToday) {
        bg = "hsl(0, 70%, 35%)";
        textColor = "#fff";
        const avgW7 = mean(w7.map((e) => e.weight));
        const avgBF7 = meanDisplayBf(w7);
        const wColor = Number.isFinite(avgW7) ? weightDisplayColor(avgW7) : textColor;
        const bfColor = Number.isFinite(avgBF7) ? bodyFatDisplayColor(avgBF7) : textColor;
        const bfFlag = gymStale ? " ❗" : "";
        innerHtml = `<span style="color:${wColor};font-weight:900;">${fmt(avgW7, 1)} kg</span> <span style="opacity:0.75;">|</span> <span style="color:${bfColor};font-weight:900;">${fmt(avgBF7, 1)}%${bfFlag}</span>`;
      } else if (todayEntry) {
        const displayBf = displayBodyFat(todayEntry);
        const wColor = weightDisplayColor(todayEntry.weight);
        const bfColor = bodyFatDisplayColor(displayBf);
        const bfFlag = gymStale ? " ❗" : "";
        innerHtml = `<span style="color:${wColor};font-weight:900;">${fmt(todayEntry.weight, 1)} kg</span> <span style="opacity:0.70;">|</span> <span style="color:${bfColor};font-weight:900;">${fmt(displayBf, 1)}%${bfFlag}</span>`;
      }
    }

    const html = `<div class="dashboard-widget dashboard-weight" data-widget="weight" data-has-today="${hasToday}" data-weight-logged="${weightLogged}" style="display:flex;justify-content:center;width:100%;">
  <button type="button" class="dashboard-weight-btn" data-action="weight-click" style="display:inline-block;padding:6px 10px;border-radius:0;border:1px solid var(--background-modifier-border);background:${bg};font-weight:600;color:${textColor};cursor:pointer;">${innerHtml}</button>
</div>`;
    return wrapWidget("weight", html);
  }

  async bakeHabits(ctx: BakeContext): Promise<string> {
    const contextDate = resolveNoteDate(ctx);
    if (shouldDeferNetworkBakes()) {
      const html = `<div class="dashboard-widget dashboard-habits" data-widget="habits" data-context-date="${contextDate}" data-loading="true" style="display:flex;justify-content:center;">
  <button type="button" class="dashboard-widget-loading-btn" data-action="refresh" data-widget="habits">Loading habits… — tap to refresh</button>
</div>`;
      return wrapWidget("habits", html);
    }

    const habits = await collectDueHabits(this.app, this.settings, contextDate);
    if (!habits.length) {
      return wrapWidget("habits", HABITS_EMPTY_HTML);
    }

    let buttons = "";
    for (const h of habits) {
      const bg = colorForOverdueDays(h.overdueDays);
      const style = [
        "display:inline-flex",
        "align-items:center",
        "white-space:nowrap",
        "padding:6px 10px",
        "border-radius:0",
        "cursor:pointer",
        bg ? `background-color:${bg};color:white;border:none` : "",
      ]
        .filter(Boolean)
        .join(";");
      buttons += `<button type="button" class="dashboard-habit-btn" data-action="habit-log" data-path="${escapeAttr(
        h.path,
      )}" data-frequency="${h.frequency}" style="${style}">${h.label}</button> `;
    }

    const html = `<div class="dashboard-widget dashboard-habits" data-widget="habits" data-context-date="${contextDate}" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;margin:0 auto;text-align:center;">
  ${buttons}
</div>`;
    return wrapWidget("habits", html);
  }

  async bakeWeightHabits(ctx: BakeContext): Promise<string> {
    const [weight, habits] = await Promise.all([this.bakeWeight(ctx), this.bakeHabits(ctx)]);
    return `<div class="dashboard-weight-habits-row">\n${weight}\n${habits}\n</div>`;
  }

  async bakeDashboardRow(ctx: BakeContext): Promise<string> {
    const [weather, hevy, weightHabits] = await Promise.all([
      this.bakeWeather(ctx),
      this.bakeHevy(ctx),
      this.bakeWeightHabits(ctx),
    ]);
    return `${weather}\n${hevy}\n${weightHabits}`;
  }

  async bakeGcal(ctx: BakeContext): Promise<string> {
    const dateYmd = resolveNoteDate(ctx);
    if (shouldDeferNetworkBakes()) {
      const body = `<tr><td colspan="2" class="dashboard-gcal-loading-cell">Loading calendar… — tap to refresh</td></tr>`;
      const html = `<div class="dashboard-widget dashboard-gcal dashboard-widget--loading" data-widget="gcal" data-loading="true" data-action="refresh" data-date="${escapeAttr(dateYmd)}" style="touch-action:pan-y;margin:0;padding:0;cursor:pointer">
  ${buildGcalWidgetInner(dateYmd, body)}
</div>`;
      return wrapWidget("gcal", html);
    }

    const exclude = this.settings.gcalExcludeCalendars ?? [];

    if (!isGoogleCalendarAuthenticated(this.app)) {
      return wrapWidget("gcal", buildGcalAuthPrompt(dateYmd));
    }

    let events: GCalEvent[] = [];
    try {
      events = await fetchCalendarEventsForDay(this.app, dateYmd, exclude);
    } catch (e) {
      if (isGoogleCalendarAuthError(e)) {
        return wrapWidget("gcal", buildGcalAuthPrompt(dateYmd));
      }
      const msg = e instanceof Error ? e.message : String(e);
      const body = `<tr><td colspan="2" style="opacity:0.7;text-align:center;padding:4px 0;border:none">${escapeHtml(msg)}</td></tr>`;
      const html = `<div class="dashboard-widget dashboard-gcal" data-widget="gcal" data-date="${escapeAttr(dateYmd)}" style="touch-action:pan-y;margin:0;padding:0">
  ${buildGcalWidgetInner(dateYmd, body)}
</div>`;
      return wrapWidget("gcal", html);
    }

    const html = `<div class="dashboard-widget dashboard-gcal" data-widget="gcal" data-date="${escapeAttr(dateYmd)}" style="touch-action:pan-y;margin:0;padding:0">
  ${buildGcalWidgetInner(dateYmd, buildGcalEventRows(events))}
</div>`;
    return wrapWidget("gcal", html);
  }

  async bakeGbOnlinePrototype(ctx: BakeContext): Promise<string> {
    const file = ctx.file;
    if (!(file instanceof TFile)) {
      return wrapWidget(
        "gb-online-prototype",
        buildGbOnlineWidgetHtml({
          weekContext: null,
          referenceDate: formatYmd(new Date()),
          fetchedAt: null,
          needsSync: true,
          gb1: { track: "gb1", label: "GB1", done: 0, total: 0, pct: 0, nextVideo: null },
          gb2: { track: "gb2", label: "GB2", done: 0, total: 0, pct: 0, nextVideo: null },
          videos: [],
          watched: {},
          revealed: {},
          error: "Open GB Online.md to use this widget.",
        }),
      );
    }

    const referenceDate = referenceDateForNote(this.app, file);
    try {
      const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
      const store = await readGbOnlineData(this.app, this.settings.gbOnlineDataPath);
      const cache = weekContext ? store.weeks[String(weekContext.weekNum)] : undefined;
      const videos = cache?.videos ?? [];
      const gb1 = computeTrackProgress(videos, store.watched, "gb1");
      const gb2 = computeTrackProgress(videos, store.watched, "gb2");
      const needsSync = !cache || !videos.length;

      return wrapWidget(
        "gb-online-prototype",
        buildGbOnlineWidgetHtml({
          weekContext,
          referenceDate,
          fetchedAt: cache?.fetchedAt ?? null,
          needsSync,
          gb1,
          gb2,
          videos,
          watched: store.watched,
          revealed: store.revealed,
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return wrapWidget(
        "gb-online-prototype",
        buildGbOnlineWidgetHtml({
          weekContext: null,
          referenceDate,
          fetchedAt: null,
          needsSync: true,
          gb1: { track: "gb1", label: "GB1", done: 0, total: 0, pct: 0, nextVideo: null },
          gb2: { track: "gb2", label: "GB2", done: 0, total: 0, pct: 0, nextVideo: null },
          videos: [],
          watched: {},
          revealed: {},
          error: msg,
        }),
      );
    }
  }

  async bakeGbOnlineDaily(ctx: BakeContext, widgetExpandedOverride?: boolean): Promise<string> {
    const logoUrl = this.gbLogoUrl();
    const file = ctx.file;
    if (!(file instanceof TFile)) {
      return wrapWidget(
        "gb-online-daily",
        buildGbOnlineDailyWidgetHtml({
          weekContext: null,
          referenceDate: formatYmd(new Date()),
          needsSync: true,
          progress: { done: 0, total: 0, pct: 0, featured: null },
          layout: { series: [] },
          videos: [],
          watched: {},
          playlistOpen: false,
          widgetExpanded: false,
          openSeriesIds: [],
          logoUrl,
          error: "Open GB Online.md to use this widget.",
        }),
      );
    }

    const referenceDate = referenceDateForNote(this.app, file);
    const isDailyNote = DAILY_NOTE_PATH_RE.test(file.path);
    const resolveWidgetExpanded = (
      store: Awaited<ReturnType<typeof readGbOnlineData>>,
      weekNum: number,
    ): boolean => {
      if (isDailyNote) return false;
      if (widgetExpandedOverride !== undefined) return widgetExpandedOverride;
      return readDailyWidgetExpanded(store, weekNum);
    };
    try {
      const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
      let store = await readGbOnlineData(this.app, this.settings.gbOnlineDataPath);
      let cache = weekContext ? store.weeks[String(weekContext.weekNum)] : undefined;
      let videos = cache?.videos ?? [];
      let needsSync = !weekContext || !cache || !videos.length;

      if (weekContext && needsSync && isSundayYmd(referenceDate) && !shouldDeferNetworkBakes()) {
        try {
          videos = await syncGbWeekIfUnsynced(this.app, this.settings, weekContext);
          store = await readGbOnlineData(this.app, this.settings.gbOnlineDataPath);
          cache = store.weeks[String(weekContext.weekNum)];
          needsSync = !videos.length;
        } catch {
          /* show sync prompt below */
        }
      }

      if (!weekContext || needsSync) {
        return wrapWidget(
          "gb-online-daily",
          buildGbOnlineDailyWidgetHtml({
            weekContext,
            referenceDate,
            needsSync,
            progress: { done: 0, total: 0, pct: 0, featured: null },
            layout: { series: [] },
            videos,
            watched: store.watched,
            playlistOpen: false,
            widgetExpanded: weekContext ? resolveWidgetExpanded(store, weekContext.weekNum) : false,
            openSeriesIds: weekContext ? readDailyOpenSeries(store, weekContext.weekNum) : [],
            logoUrl,
          }),
        );
      }

      const layout = await readDailyLayoutForWeek(this.app, this.settings, weekContext.weekNum, videos);
      const progress = computeDailyProgress(videos, layout, store.watched);
      const playlistOpen = readDailyPlaylistOpen(store, weekContext.weekNum);
      const widgetExpanded = resolveWidgetExpanded(store, weekContext.weekNum);
      const openSeriesIds = readDailyOpenSeries(store, weekContext.weekNum);

      return wrapWidget(
        "gb-online-daily",
        buildGbOnlineDailyWidgetHtml({
          weekContext,
          referenceDate,
          needsSync: false,
          progress,
          layout,
          videos,
          watched: store.watched,
          playlistOpen,
          widgetExpanded,
          openSeriesIds,
          logoUrl,
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return wrapWidget(
        "gb-online-daily",
        buildGbOnlineDailyWidgetHtml({
          weekContext: null,
          referenceDate,
          needsSync: true,
          progress: { done: 0, total: 0, pct: 0, featured: null },
          layout: { series: [] },
          videos: [],
          watched: {},
          playlistOpen: false,
          widgetExpanded: false,
          openSeriesIds: [],
          logoUrl,
          error: msg,
        }),
      );
    }
  }
}
