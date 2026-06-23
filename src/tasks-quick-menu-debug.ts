import { Notice } from "obsidian";
import type { SaveableTask } from "./tasks-save";

let getDebugEnabled: () => boolean = () => false;

export function configureQuickMenuDebug(getter: () => boolean): void {
  getDebugEnabled = getter;
}

export function isQuickMenuDebugEnabled(): boolean {
  return getDebugEnabled();
}

export function qmLog(label: string, data?: unknown): void {
  if (!getDebugEnabled()) return;
  if (data === undefined) {
    console.log(`[LifeAdmin ⚡] ${label}`);
  } else {
    console.log(`[LifeAdmin ⚡] ${label}`, data);
  }
}

export function qmFail(label: string, data?: unknown): void {
  console.warn(`[LifeAdmin ⚡] FAIL: ${label}`, data ?? "");
  if (getDebugEnabled()) {
    const detail = data !== undefined ? `: ${JSON.stringify(data, replacer, 0).slice(0, 400)}` : "";
    new Notice(`LifeAdmin ⚡ ${label}${detail}`, 10000);
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "format" in value && typeof (value as { format: unknown }).format === "function") {
    return (value as { format: (f: string) => string }).format("YYYY-MM-DD");
  }
  return value;
}

export function summarizeTask(task: SaveableTask | null | undefined): Record<string, unknown> | null {
  if (!task) return null;
  return {
    path: task.taskLocation?.path,
    lineNumber: task.taskLocation?.lineNumber,
    description: task.description?.slice(0, 80),
    due: task.dueDate?.format?.("YYYY-MM-DD") ?? null,
    scheduled: task.scheduledDate?.format?.("YYYY-MM-DD") ?? null,
    start: task.startDate?.format?.("YYYY-MM-DD") ?? null,
    priority: task.priority,
    hasToFileLineString: typeof task.toFileLineString === "function",
    hasFromLine: typeof (task.constructor as { fromLine?: unknown }).fromLine === "function",
    originalMarkdown: task.originalMarkdown?.slice(0, 120),
  };
}

export interface LineFindDiagnostics {
  lineNumber: number;
  lineAtNumber?: string;
  lineAtNumberIsTask: boolean;
  lineAtNumberMatchesDesc: boolean;
  originalMarkdownMatches: number[];
  descriptionMatches: number[];
  reason: string;
}

export function diagnoseLineFind(task: SaveableTask, lines: string[]): LineFindDiagnostics {
  const lineNumber = task.taskLocation.lineNumber;
  const lineAtNumber = lineNumber >= 0 && lineNumber < lines.length ? lines[lineNumber] : undefined;
  const originalMarkdown = task.originalMarkdown;
  const originalMarkdownMatches: number[] = [];
  const descriptionMatches: number[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (originalMarkdown && lines[index] === originalMarkdown) originalMarkdownMatches.push(index);
    if (lineMatchesTaskForDebug(task, lines[index]!)) descriptionMatches.push(index);
  }

  let reason = "unknown";
  if (lineNumber < 0 || lineNumber >= lines.length) {
    reason = "line number out of range";
  } else if (originalMarkdown && lineAtNumber === originalMarkdown) {
    reason = "exact markdown at line number";
  } else if (lineAtNumber && lineMatchesTaskForDebug(task, lineAtNumber)) {
    reason = "description match at line number";
  } else if (originalMarkdownMatches.length === 1) {
    reason = "single markdown scan match";
  } else if (originalMarkdownMatches.length > 1) {
    reason = `ambiguous markdown matches (${originalMarkdownMatches.length})`;
  } else if (descriptionMatches.length === 1) {
    reason = "single description scan match";
  } else if (descriptionMatches.length > 1) {
    reason = `ambiguous description matches (${descriptionMatches.length})`;
  } else if (!originalMarkdown) {
    reason = "no originalMarkdown on task";
  } else {
    reason = "no matching line found";
  }

  return {
    lineNumber,
    lineAtNumber: lineAtNumber?.slice(0, 120),
    lineAtNumberIsTask: !!lineAtNumber && /^\s*- \[[ xX/\-]\]/.test(lineAtNumber),
    lineAtNumberMatchesDesc: !!lineAtNumber && lineMatchesTaskForDebug(task, lineAtNumber),
    originalMarkdownMatches,
    descriptionMatches,
    reason,
  };
}

function lineMatchesTaskForDebug(task: SaveableTask, line: string): boolean {
  if (!line || !/^\s*- \[[ xX/\-]\]/.test(line)) return false;
  const desc = task.description?.trim();
  if (!desc) return false;
  const normalize = (text: string): string =>
    text
      .replace(/🔺|⏫|🔼|🔽|⏬/g, "")
      .replace(/📅|📆|🗓|⏳|⌛|🛫|✅|🔁|⛔|🆔|🔗/g, "")
      .replace(/\d{4}-\d{2}-\d{2}/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const normalizedLine = normalize(line);
  const normalizedDesc = normalize(desc);
  return normalizedLine.includes(normalizedDesc) || normalizedDesc.includes(normalizedLine);
}
