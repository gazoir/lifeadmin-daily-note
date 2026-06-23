import { App, normalizePath, TFile } from "obsidian";
import { eventIgnoreKeys, eventStartIso, eventTitle, type GCalEvent } from "./gcal-events";
import { formatYmd } from "./utils";

export interface IgnoredCalendarEntry {
  seriesKey: string;
  title: string;
  dateYmd: string;
}

const FILE_HEADER = `# Ignored calendar events

Delete a line to show that event in the project picker again.
Entries stay here until you remove them (old dates are kept so hides don't come back).

`;

const LINE_RE = /^([^\s#|]+)(?:\s*\|\s*([^|]*?)\s*\|\s*(\d{4}-\d{2}-\d{2}))?\s*(?:#.*)?$/;

function cullAncientEntries(entries: IgnoredCalendarEntry[], today: string): IgnoredCalendarEntry[] {
  const moment = (window as unknown as { moment?: (inp: string) => { subtract: (n: number, u: string) => { format: (f: string) => string } } }).moment;
  if (typeof moment !== "function") return entries;
  const cutoff = moment(today).subtract(400, "days").format("YYYY-MM-DD");
  return entries.filter((entry) => !entry.dateYmd || entry.dateYmd >= cutoff);
}

function todayYmd(): string {
  const moment = (window as unknown as { moment?: (inp?: unknown) => { format: (f: string) => string } }).moment;
  if (typeof moment === "function") return moment().format("YYYY-MM-DD");
  return formatYmd(new Date());
}

function parseIgnoredLine(line: string): IgnoredCalendarEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(LINE_RE);
  if (!match) return null;
  const key = match[1].trim();
  if (!key) return null;
  return {
    seriesKey: key,
    title: (match[2] ?? "").trim(),
    dateYmd: (match[3] ?? "").trim(),
  };
}

function formatIgnoredLine(entry: IgnoredCalendarEntry): string {
  const title = entry.title || "Untitled event";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(entry.dateYmd) ? entry.dateYmd : "????-??-??";
  return `${entry.seriesKey} | ${title} | ${date}`;
}

function serializeIgnoredEntries(entries: IgnoredCalendarEntry[]): string {
  const lines = entries
    .slice()
    .sort((a, b) => a.dateYmd.localeCompare(b.dateYmd) || a.title.localeCompare(b.title))
    .map(formatIgnoredLine);
  return `${FILE_HEADER}${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function dedupeEntries(entries: IgnoredCalendarEntry[]): IgnoredCalendarEntry[] {
  const byKey = new Map<string, IgnoredCalendarEntry>();
  for (const entry of entries) {
    const prev = byKey.get(entry.seriesKey);
    if (!prev || entry.dateYmd.localeCompare(prev.dateYmd) > 0) {
      byKey.set(entry.seriesKey, entry);
    }
  }
  return Array.from(byKey.values());
}

export function parseIgnoredFileContent(content: string): IgnoredCalendarEntry[] {
  const entries: IgnoredCalendarEntry[] = [];
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const parsed = parseIgnoredLine(line);
    if (parsed) entries.push(parsed);
  }
  return dedupeEntries(entries);
}

async function ensureIgnoredFile(app: App, path: string): Promise<TFile> {
  const normalized = normalizePath(path);
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing instanceof TFile) return existing;

  const folder = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
  if (folder && !(await app.vault.adapter.exists(folder))) {
    await app.vault.adapter.mkdir(folder);
  }
  return app.vault.create(normalized, FILE_HEADER);
}

export async function readIgnoredCalendarEntries(app: App, path: string): Promise<IgnoredCalendarEntry[]> {
  const file = await ensureIgnoredFile(app, path);
  const content = await app.vault.read(file);
  const today = todayYmd();
  const culled = cullAncientEntries(parseIgnoredFileContent(content), today);
  const serialized = serializeIgnoredEntries(culled);
  if (serialized !== content.replace(/\r\n/g, "\n")) {
    await app.vault.modify(file, serialized);
  }
  return culled;
}

export async function readIgnoredSeriesKeys(app: App, path: string): Promise<Set<string>> {
  const entries = await readIgnoredCalendarEntries(app, path);
  return new Set(entries.map((entry) => entry.seriesKey));
}

export async function addIgnoredCalendarEvent(app: App, path: string, event: GCalEvent): Promise<void> {
  const file = await ensureIgnoredFile(app, path);
  const content = await app.vault.read(file);
  const today = todayYmd();
  const entries = cullAncientEntries(parseIgnoredFileContent(content), today);
  const title = eventTitle(event) || "Untitled event";
  const dateYmd = eventStartIso(event).slice(0, 10) || today;
  const keys = eventIgnoreKeys(event);

  let next = entries.filter((entry) => !keys.includes(entry.seriesKey));
  for (const key of keys) {
    next.push({ seriesKey: key, title, dateYmd });
  }
  await app.vault.modify(file, serializeIgnoredEntries(dedupeEntries(next)));
}

export async function migrateHiddenSeriesToIgnoredFile(
  app: App,
  path: string,
  legacyKeys: string[],
): Promise<string[]> {
  if (!legacyKeys.length) return [];
  const file = await ensureIgnoredFile(app, path);
  const content = await app.vault.read(file);
  const today = todayYmd();
  const entries = cullAncientEntries(parseIgnoredFileContent(content), today);
  const known = new Set(entries.map((entry) => entry.seriesKey));
  const migrated: string[] = [];

  for (const key of legacyKeys) {
    const trimmed = String(key ?? "").trim();
    if (!trimmed || known.has(trimmed)) continue;
    entries.push({ seriesKey: trimmed, title: "Migrated hidden event", dateYmd: today });
    known.add(trimmed);
    migrated.push(trimmed);
  }

  if (migrated.length) {
    await app.vault.modify(file, serializeIgnoredEntries(dedupeEntries(entries)));
  }
  return migrated;
}
