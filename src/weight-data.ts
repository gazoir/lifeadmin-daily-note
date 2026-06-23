import type { App } from "obsidian";
import { TFile } from "obsidian";
import { clamp, clamp01, lerp, numFrom, stripFrontmatter } from "./utils";

export const ARBOLEAF_BF_CALIBRATION = 3.5;
export const GYM_STALE_DAYS = 7;

const WEIGHT_GREEN_MIN = 79;
const WEIGHT_GREEN_MAX = 81;
const WEIGHT_RED_HIGH = 85;
const WEIGHT_RED_LOW = 77;
const BF_GREEN_MAX = 11;
const BF_RED_AT = 15;

export interface WeightEntry {
  dateStr: string;
  weight: number;
  bf: number;
  source: string;
  isGym: boolean;
}

export function isGymSource(source: string): boolean {
  const s = source.toLowerCase();
  return s.includes("inbody") || s.includes("boditrax");
}

export function parseWeightLine(line: string): WeightEntry | null {
  const clean = line.trim().replace(/^\-\s*/, "");
  if (!clean) return null;

  const m = clean.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*([\d.]+)\s*-\s*([\d.]+|[-])(?:\s*-\s*(.*))?$/i);
  if (m) {
    const [, dateStr, wStr, bfStr, sourceRaw] = m;
    if (bfStr === "-") return null;
    const weight = numFrom(wStr);
    const bf = numFrom(bfStr);
    if (!Number.isFinite(weight) || !Number.isFinite(bf)) return null;
    const source = (sourceRaw ?? "arboleaf").trim() || "arboleaf";
    return { dateStr, weight, bf, source, isGym: isGymSource(source) };
  }

  // e.g. "2026-05-31 - 83.7 10.5 - InBody" (missing middle dash)
  const loose = clean.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*([\d.]+)\s+([\d.]+)\s*-\s*(.+)$/i);
  if (loose) {
    const [, dateStr, wStr, bfStr, sourceRaw] = loose;
    const weight = numFrom(wStr);
    const bf = numFrom(bfStr);
    if (!Number.isFinite(weight) || !Number.isFinite(bf)) return null;
    const source = sourceRaw.trim();
    return { dateStr, weight, bf, source, isGym: isGymSource(source) };
  }

  return null;
}

export function parseWeightEntries(markdown: string): WeightEntry[] {
  return stripFrontmatter(markdown)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseWeightLine)
    .filter((v): v is WeightEntry => v !== null)
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}

/** Gym-equivalent body fat for display (Arboleaf readings only are adjusted). */
export function displayBodyFat(entry: WeightEntry): number {
  return entry.isGym ? entry.bf : entry.bf - ARBOLEAF_BF_CALIBRATION;
}

export function lastGymWeighInDate(entries: WeightEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].isGym) return entries[i].dateStr;
  }
  return null;
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const parse = (ymd: string): Date | null => {
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const a = parse(fromYmd);
  const b = parse(toYmd);
  if (!a || !b) return 0;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function needsGymCalibrationReminder(noteDate: string, entries: WeightEntry[]): boolean {
  const lastGym = lastGymWeighInDate(entries);
  if (!lastGym) return true;
  return daysBetweenYmd(noteDate, lastGym) > GYM_STALE_DAYS;
}

function greenRedGradient(t: number): string {
  return `hsl(${lerp(120, 0, clamp(t, 0, 1))}, 75%, 45%)`;
}

export function weightDisplayColor(kg: number): string {
  if (kg >= WEIGHT_GREEN_MIN && kg <= WEIGHT_GREEN_MAX) {
    return greenRedGradient(0);
  }
  if (kg > WEIGHT_GREEN_MAX) {
    const span = WEIGHT_RED_HIGH - WEIGHT_GREEN_MAX;
    const t = span > 0 ? (kg - WEIGHT_GREEN_MAX) / span : 1;
    return greenRedGradient(t);
  }
  const span = WEIGHT_GREEN_MIN - WEIGHT_RED_LOW;
  const t = span > 0 ? (WEIGHT_GREEN_MIN - kg) / span : 1;
  return greenRedGradient(t);
}

export function bodyFatDisplayColor(bf: number): string {
  if (bf <= BF_GREEN_MAX) return greenRedGradient(0);
  if (bf >= BF_RED_AT) return greenRedGradient(1);
  const t = (bf - BF_GREEN_MAX) / (BF_RED_AT - BF_GREEN_MAX);
  return greenRedGradient(t);
}

export function meanDisplayBf(entries: WeightEntry[]): number {
  if (!entries.length) return NaN;
  return entries.reduce((s, e) => s + displayBodyFat(e), 0) / entries.length;
}

export function formatWeightLine(dateStr: string, weight: number, bf: number, source: string): string {
  return `${dateStr} - ${weight} - ${bf} - ${source}`;
}

export async function appendWeightEntry(
  app: App,
  path: string,
  entry: Pick<WeightEntry, "dateStr" | "weight" | "bf" | "source">,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    throw new Error(`Weight file not found: ${path}`);
  }
  const raw = (await app.vault.read(file)).replace(/\r\n/g, "\n");
  const line = formatWeightLine(entry.dateStr, entry.weight, entry.bf, entry.source);
  const next = raw.endsWith("\n") || raw.length === 0 ? `${raw}${line}\n` : `${raw}\n${line}\n`;
  await app.vault.modify(file, next);
}
