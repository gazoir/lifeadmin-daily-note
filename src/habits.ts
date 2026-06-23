import type { App, TFile } from "obsidian";
import { parseYaml } from "obsidian";
import type { LifeAdminSettings } from "./settings";

export function frontmatterFromMarkdown(content: string): Record<string, unknown> {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return {};
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return {};
  const parsed = parseYaml(normalized.slice(4, end));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export interface HabitMeta {
  frequency: number;
  nextDate: string | null;
  hideDate: string | null;
  weekdays: number[] | null;
  modal: boolean;
}

export interface HabitButtonData {
  path: string;
  label: string;
  overdueDays: number;
  frequency: number;
}

const WEEKDAY_NAMES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

export function normalizeYmd(v: unknown): string | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  if (typeof v === "object" && v !== null && "toISODate" in v) {
    const fn = (v as { toISODate?: () => string }).toISODate;
    if (typeof fn === "function") return fn();
  }
  return null;
}

export function parseWeekdays(raw: unknown): number[] | null {
  if (raw == null || raw === "") return null;
  const tokens: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) tokens.push(String(item));
  } else {
    tokens.push(...String(raw).split(/[,;|/]+/));
  }
  const days: number[] = [];
  for (const token of tokens) {
    const day = parseWeekdayToken(token.trim());
    if (day !== null && !days.includes(day)) days.push(day);
  }
  days.sort((a, b) => a - b);
  return days.length ? days : null;
}

function parseWeekdayToken(token: string): number | null {
  if (!token) return null;
  const key = token.toLowerCase().replace(/\.$/, "");
  if (key in WEEKDAY_NAMES) return WEEKDAY_NAMES[key];
  const num = Number(key);
  if (Number.isInteger(num) && num >= 0 && num <= 6) return num;
  return null;
}

function parseModalFlag(raw: unknown): boolean {
  if (raw == null || raw === "") return true;
  if (typeof raw === "boolean") return raw;
  const key = String(raw).trim().toLowerCase();
  if (key === "false" || key === "no" || key === "0") return false;
  return true;
}

export function habitMetaFromFrontmatter(fm: Record<string, unknown>): HabitMeta {
  return {
    frequency: Number(fm.Frequency ?? fm.frequency ?? 1) || 1,
    nextDate: normalizeYmd(fm.Next_Date ?? fm.next_date ?? fm.NextDate),
    hideDate: normalizeYmd(fm.Hide_Date ?? fm.hide_date ?? fm.HideDate ?? fm.Hide),
    weekdays: parseWeekdays(fm.Days ?? fm.days ?? fm.Weekdays ?? fm.weekdays),
    modal: parseModalFlag(fm.Modal ?? fm.modal),
  };
}

function parseYmd(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function weekdayFromYmd(ymd: string): number | null {
  const dt = parseYmd(ymd);
  return dt ? dt.getUTCDay() : null;
}

export function addDaysYmd(ymd: string, days: number): string {
  const dt = parseYmd(ymd);
  if (!dt) return ymd;
  const out = new Date(dt.getTime() + days * 86400000);
  const y = out.getUTCFullYear();
  const m = String(out.getUTCMonth() + 1).padStart(2, "0");
  const d = String(out.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function diffDays(fromYmd: string, toYmd: string): number {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) return 0;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/** Next scheduled weekday strictly after `fromYmd`. */
export function nextWeeklyDueDate(fromYmd: string, weekdays: number[]): string {
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = addDaysYmd(fromYmd, offset);
    const dow = weekdayFromYmd(candidate);
    if (dow !== null && weekdays.includes(dow)) return candidate;
  }
  return addDaysYmd(fromYmd, 7);
}

export function nextDateAfterHabitLog(contextDate: string, meta: HabitMeta): string {
  if (meta.weekdays?.length) return nextWeeklyDueDate(contextDate, meta.weekdays);
  return addDaysYmd(contextDate, Math.max(0, meta.frequency));
}

function splitMarkdownFrontmatter(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { frontmatter: "", body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: "", body: normalized };
  return {
    frontmatter: normalized.slice(0, end + 5),
    body: normalized.slice(end + 5),
  };
}

function formatLogLine(date: string, details: string): string {
  const d = String(details ?? "").trim();
  return d.length ? `${date} - ${d}` : date;
}

export function upsertLogLineInBody(content: string, date: string, details: string): string {
  const { frontmatter, body } = splitMarkdownFrontmatter(content);
  const lines = body.split("\n");
  const re = /^(\d{4}-\d{2}-\d{2})(?:\s*-\s*(.*))?$/;
  let replaced = false;
  const out = lines.map((line) => {
    const m = line.trimEnd().match(re);
    if (!m || m[1] !== date) return line;
    replaced = true;
    return formatLogLine(date, details);
  });
  let newBody: string;
  if (!replaced) {
    const trimmed = body.replace(/\s+$/g, "");
    const line = formatLogLine(date, details);
    newBody = trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
  } else {
    newBody = out.join("\n").replace(/\s+$/g, "") + "\n";
  }
  return frontmatter + newBody;
}

export async function saveHabitLog(
  app: App,
  habitFile: TFile,
  contextDate: string,
  details: string,
): Promise<string> {
  const current = await app.vault.read(habitFile);
  const meta = habitMetaFromFrontmatter(frontmatterFromMarkdown(current));
  const nextDate = nextDateAfterHabitLog(contextDate, meta);

  await app.fileManager.processFrontMatter(habitFile, (fm) => {
    fm.Next_Date = nextDate;
    const hide = normalizeYmd(fm.Hide_Date ?? fm.hide_date ?? fm.HideDate ?? fm.Hide);
    if (hide === contextDate) fm.Hide_Date = "";
  });

  const latest = await app.vault.read(habitFile);
  const withLog = upsertLogLineInBody(latest, contextDate, details);
  if (withLog !== latest.replace(/\r\n/g, "\n")) {
    await app.vault.modify(habitFile, withLog);
  }

  return nextDate;
}

export async function hideHabitForDate(app: App, habitFile: TFile, contextDate: string): Promise<void> {
  await app.fileManager.processFrontMatter(habitFile, (fm) => {
    fm.Hide_Date = contextDate;
  });
}

function isHabitPotentiallyDue(meta: HabitMeta, contextDate: string): boolean {
  if (meta.hideDate === contextDate) return false;

  if (meta.weekdays?.length) {
    const dow = weekdayFromYmd(contextDate);
    if (dow === null || !meta.weekdays.includes(dow)) return false;
    if (!meta.nextDate) return true;
    return diffDays(contextDate, meta.nextDate) >= 0;
  }

  if (!meta.nextDate) return true;
  return diffDays(contextDate, meta.nextDate) >= 0;
}

export function isHabitDueOnDate(meta: HabitMeta, contextDate: string, body?: string): boolean {
  if (meta.hideDate === contextDate) return false;

  if (meta.weekdays?.length) {
    const dow = weekdayFromYmd(contextDate);
    if (dow === null || !meta.weekdays.includes(dow)) return false;
    if (body && hasLogForDate(body, contextDate)) return false;
    if (!meta.nextDate) return true;
    return diffDays(contextDate, meta.nextDate) >= 0;
  }

  if (!meta.nextDate) return true;
  return diffDays(contextDate, meta.nextDate) >= 0;
}

function countMissedWeeklyOccurrences(
  weekdays: number[],
  fromYmd: string,
  untilYmd: string,
  body: string,
): number {
  let missed = 0;
  let cursor = fromYmd;
  while (diffDays(untilYmd, cursor) > 0) {
    const dow = weekdayFromYmd(cursor);
    if (dow !== null && weekdays.includes(dow) && !hasLogForDate(body, cursor)) missed++;
    cursor = addDaysYmd(cursor, 1);
  }
  return missed;
}

export function habitOverdueDays(meta: HabitMeta, contextDate: string, body?: string): number {
  if (meta.weekdays?.length) {
    if (!meta.nextDate || diffDays(contextDate, meta.nextDate) <= 0) return 0;
    if (!body) return 1;
    return countMissedWeeklyOccurrences(meta.weekdays, meta.nextDate, contextDate, body);
  }
  if (!meta.nextDate) return 999;
  const overdue = diffDays(contextDate, meta.nextDate);
  return overdue >= 0 ? overdue : 0;
}

export function extractEmoji(name: string): string {
  const chars = Array.from(String(name ?? "").trim());
  return chars.length ? chars[0] : "✅";
}

export function formatHabitLabel(emoji: string, details: string): string {
  const d = (details ?? "").trim();
  return d.length ? `${emoji} ${d}` : emoji;
}

function parseLogEntries(text: string): Array<{ date: string; details: string }> {
  const re = /^(\d{4}-\d{2}-\d{2})(?:\s*-\s*(.*))?$/;
  return text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(re);
      return m ? { date: m[1], details: m[2] ?? "" } : null;
    })
    .filter((v): v is { date: string; details: string } => v !== null);
}

function hasLogForDate(body: string, ymd: string): boolean {
  return parseLogEntries(body).some((entry) => entry.date === ymd);
}

export function latestLogEntry(text: string): { date: string; details: string } | null {
  const entries = parseLogEntries(text);
  if (!entries.length) return null;
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries[entries.length - 1];
}

function hasTag(app: App, file: TFile, tag: string): boolean {
  const tags =
    app.metadataCache.getFileCache(file)?.tags?.map((t) => t.tag.replace(/^#/, "").toLowerCase()) ?? [];
  return tags.includes(tag.replace(/^#/, "").toLowerCase());
}

function habitMetaFromFileCache(app: App, file: TFile): HabitMeta {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  return habitMetaFromFrontmatter((fm ?? {}) as Record<string, unknown>);
}

export async function collectDueHabits(
  app: App,
  settings: LifeAdminSettings,
  contextDate: string,
): Promise<HabitButtonData[]> {
  const out: HabitButtonData[] = [];
  const files = app.vault
    .getFiles()
    .filter(
      (f) =>
        f.path.startsWith(settings.habitsFolder + "/") &&
        f.extension === "md" &&
        !hasTag(app, f, settings.habitIgnoreTag),
    );

  for (const file of files.sort((a, b) => a.basename.localeCompare(b.basename))) {
    const meta = habitMetaFromFileCache(app, file);
    if (!isHabitPotentiallyDue(meta, contextDate)) continue;

    const body = await app.vault.read(file);
    if (!isHabitDueOnDate(meta, contextDate, body)) continue;

    const latest = latestLogEntry(body);
    out.push({
      path: file.path,
      label: formatHabitLabel(extractEmoji(file.basename), latest?.details ?? ""),
      overdueDays: habitOverdueDays(meta, contextDate, body),
      frequency: meta.frequency,
    });
  }

  return out;
}

export const HABITS_EMPTY_HTML =
  '<div class="dashboard-widget dashboard-habits dashboard-habits--empty" aria-hidden="true"></div>';
