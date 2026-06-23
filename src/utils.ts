import type { TFile } from "obsidian";

export interface BakeContext {
  noteDate: string;
  file?: TFile;
}

export type WidgetName =
  | "weather"
  | "hevy"
  | "weight"
  | "habits"
  | "gcal"
  | "gb-online-prototype"
  | "gb-online-daily";

export function widgetMarkers(widget: WidgetName): { start: string; end: string } {
  return {
    start: `<!-- dashboard:${widget}:start -->`,
    end: `<!-- dashboard:${widget}:end -->`,
  };
}

export function wrapWidget(widget: WidgetName, innerHtml: string): string {
  const { start, end } = widgetMarkers(widget);
  return `${start}\n${innerHtml}\n${end}`;
}

export function noteDateFromFile(file: TFile): string {
  const name = file.basename;
  return /^\d{4}-\d{2}-\d{2}$/.test(name) ? name : formatYmd(new Date());
}

export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function numFrom(s: unknown): number {
  const m = String(s ?? "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

export function fmt(n: number, d = 1): string {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

export function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function stripFrontmatter(text: string): string {
  const s = text.replace(/\r\n/g, "\n");
  if (!s.startsWith("---\n")) return s;
  const endIdx = s.indexOf("\n---\n", 4);
  return endIdx === -1 ? s : s.slice(endIdx + 5);
}

export function escapeAttr(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
