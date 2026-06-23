import { Notice, TFile, type App } from "obsidian";
import type { HappensField, MomentLike, TasksTaskLike } from "./tasks-line-edit";
import { formatDateString, getCurrentHappensMoment, getDateFieldToPostpone } from "./tasks-line-edit";
import { diagnoseLineFind, qmFail, qmLog, summarizeTask } from "./tasks-quick-menu-debug";

export interface SaveableTask extends TasksTaskLike {
  originalMarkdown?: string;
  status?: { symbol: string };
  description?: string;
  indentation?: string;
  listMarker?: string;
  priority?: string;
  createdDate?: MomentLike | null;
  doneDate?: MomentLike | null;
  cancelledDate?: MomentLike | null;
  recurrence?: unknown;
  onCompletion?: unknown;
  dependsOn?: unknown;
  id?: string;
  blockLink?: string;
  tags?: string[];
  scheduledDateIsInferred?: boolean;
  parent?: unknown;
  toFileLineString?: () => string;
}

interface TasksPluginLike {
  getTasks?: () => SaveableTask[];
  getState?: () => string;
}

interface TaskConstructor {
  new (props: Record<string, unknown>): SaveableTask;
  fromLine?(args: {
    line: string;
    taskLocation: SaveableTask["taskLocation"];
    fallbackDate: null;
  }): SaveableTask | null;
}

const TASK_LINE_RE = /^\s*- \[[ xX/\-]\]/;
const SAVE_RETRY_DELAYS_MS = [0, 50, 100, 200, 400, 800, 1200];

function getTasksPlugin(app: App): TasksPluginLike | null {
  const plugin = app.plugins.plugins["obsidian-tasks-plugin"] as TasksPluginLike | undefined;
  return plugin?.getTasks ? plugin : null;
}

function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "").toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function lineMatchesTask(task: SaveableTask, line: string): boolean {
  if (!line || !TASK_LINE_RE.test(line)) return false;
  const desc = task.description?.trim();
  if (!desc) return false;
  const normalizedLine = normalizeForLineMatch(line);
  const normalizedDesc = normalizeForLineMatch(desc);
  return normalizedLine.includes(normalizedDesc) || normalizedDesc.includes(normalizedLine);
}

function normalizeForLineMatch(text: string): string {
  return text
    .replace(/🔺|⏫|🔼|🔽|⏬/g, "")
    .replace(/📅|📆|🗓|⏳|⌛|🛫|✅|🔁|⛔|🆔|🔗/g, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Re-read the task from Tasks cache so line content and dates are current. */
export function refreshTask(app: App, task: TasksTaskLike): SaveableTask | null {
  const plugin = getTasksPlugin(app);
  const tasks = plugin?.getTasks?.() ?? [];
  const path = task.taskLocation.path;
  const originalMarkdown = (task as SaveableTask).originalMarkdown;
  const lineNumber = task.taskLocation.lineNumber;

  qmLog("refreshTask", {
    tasksCacheState: plugin?.getState?.(),
    taskCount: tasks.length,
    hint: summarizeTask(task as SaveableTask),
  });

  const onPath = tasks.filter((candidate) => pathsEqual(candidate.taskLocation.path, path));

  if (originalMarkdown) {
    const byMarkdown = onPath.filter((candidate) => candidate.originalMarkdown === originalMarkdown);
    if (byMarkdown.length === 1) {
      qmLog("refreshTask matched by originalMarkdown");
      return byMarkdown[0]!;
    }
  }

  const byLine = onPath.filter((candidate) => candidate.taskLocation.lineNumber === lineNumber);
  if (byLine.length === 1) {
    qmLog("refreshTask matched by lineNumber");
    return byLine[0]!;
  }

  if (byLine.length > 1) {
    qmLog("refreshTask ambiguous lineNumber matches", { count: byLine.length });
  }

  return byLine[0] ?? null;
}

function findTaskLineIndex(task: SaveableTask, lines: string[]): number | null {
  const lineNumber = task.taskLocation.lineNumber;
  const originalMarkdown = task.originalMarkdown;

  if (lineNumber >= 0 && lineNumber < lines.length) {
    const atLine = lines[lineNumber]!;
    if (originalMarkdown && atLine === originalMarkdown) return lineNumber;
    if (lineMatchesTask(task, atLine)) return lineNumber;
  }

  if (originalMarkdown) {
    const matches: number[] = [];
    for (let index = 0; index < lines.length; index++) {
      if (lines[index] === originalMarkdown) matches.push(index);
    }
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      if (matches.includes(lineNumber)) return lineNumber;
      for (const index of matches) {
        if (lineMatchesTask(task, lines[index]!)) return index;
      }
      return null;
    }
  }

  const descriptionMatches: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lineMatchesTask(task, lines[index]!)) descriptionMatches.push(index);
  }
  if (descriptionMatches.length === 1) return descriptionMatches[0]!;
  if (descriptionMatches.length > 1 && descriptionMatches.includes(lineNumber)) return lineNumber;

  return null;
}

function parseTaskFromFileLine(task: SaveableTask, line: string): SaveableTask | null {
  const TaskClass = task.constructor as TaskConstructor;
  if (typeof TaskClass.fromLine !== "function") {
    qmLog("parseTaskFromFileLine: Task.fromLine unavailable");
    return null;
  }
  const parsed = TaskClass.fromLine({
    line,
    taskLocation: task.taskLocation,
    fallbackDate: null,
  });
  if (!parsed) {
    qmLog("parseTaskFromFileLine returned null", { line: line.slice(0, 120) });
  }
  return parsed;
}

function cloneTask(task: SaveableTask, updates: Record<string, unknown>): SaveableTask {
  const TaskClass = task.constructor as TaskConstructor;
  const props: Record<string, unknown> = {
    status: task.status,
    description: task.description,
    taskLocation: task.taskLocation,
    indentation: task.indentation,
    listMarker: task.listMarker,
    priority: task.priority,
    createdDate: task.createdDate,
    startDate: task.startDate,
    scheduledDate: task.scheduledDate,
    dueDate: task.dueDate,
    doneDate: task.doneDate,
    cancelledDate: task.cancelledDate,
    recurrence: task.recurrence,
    onCompletion: task.onCompletion,
    dependsOn: task.dependsOn,
    id: task.id,
    blockLink: task.blockLink,
    tags: task.tags,
    originalMarkdown: task.originalMarkdown,
    scheduledDateIsInferred: task.scheduledDateIsInferred,
    parent: task.parent,
    ...updates,
  };

  if (
    updates.scheduledDate !== undefined &&
    task.scheduledDateIsInferred &&
    task.scheduledDate &&
    updates.scheduledDate &&
    typeof (task.scheduledDate as MomentLike).isSame === "function" &&
    !(task.scheduledDate as MomentLike).isSame(updates.scheduledDate as MomentLike, "day")
  ) {
    props.scheduledDateIsInferred = false;
  }

  return new TaskClass(props);
}

async function replaceTaskInFileOnce(
  app: App,
  hintTask: SaveableTask,
  updates: Record<string, unknown>,
  attempt: number,
): Promise<{ saved: boolean; updatedTask?: SaveableTask; failure?: string }> {
  qmLog(`replaceTask attempt ${attempt}`, { hint: summarizeTask(hintTask), updates });

  const task = refreshTask(app, hintTask) ?? hintTask;

  if (typeof task.toFileLineString !== "function") {
    return { saved: false, failure: "task missing toFileLineString()" };
  }

  const file = app.vault.getAbstractFileByPath(task.taskLocation.path);
  if (!(file instanceof TFile)) {
    return { saved: false, failure: `file not found: ${task.taskLocation.path}` };
  }

  const lines = (await app.vault.read(file)).split("\n");
  const lineIndex = findTaskLineIndex(task, lines);
  if (lineIndex === null) {
    const diag = diagnoseLineFind(task, lines);
    qmFail("line not found", diag);
    return { saved: false, failure: diag.reason };
  }

  const lineInFile = lines[lineIndex]!;
  const parsedFromFile = parseTaskFromFileLine(task, lineInFile);
  const baseTask = parsedFromFile ?? task;

  if (!parsedFromFile) {
    qmLog("using cached task object as base (fromLine failed)", summarizeTask(task));
  }

  const updated = cloneTask(baseTask, {
    ...updates,
    originalMarkdown: lineInFile,
  });

  if (typeof updated.toFileLineString !== "function") {
    return { saved: false, failure: "cloned task missing toFileLineString()" };
  }

  const newLine = updated.toFileLineString();
  qmLog("writing line", {
    lineIndex,
    before: lineInFile.slice(0, 140),
    after: newLine.slice(0, 140),
    unchanged: newLine === lineInFile,
  });

  if (newLine === lineInFile) {
    qmFail("no change in line text", { lineIndex, updates });
    return { saved: false, failure: "line unchanged after update" };
  }

  lines[lineIndex] = newLine;
  await app.vault.modify(file, lines.join("\n"));
  qmLog("vault.modify complete", { path: file.path, lineIndex });
  const savedTask = cloneTask(updated, { originalMarkdown: newLine });
  return { saved: true, updatedTask: savedTask };
}

export async function replaceTaskInFile(
  app: App,
  hintTask: SaveableTask,
  updates: Record<string, unknown>,
): Promise<SaveableTask | null> {
  qmLog("replaceTaskInFile start", { hint: summarizeTask(hintTask), updates });

  let lastFailure = "unknown";
  for (let attempt = 0; attempt < SAVE_RETRY_DELAYS_MS.length; attempt++) {
    const delayMs = SAVE_RETRY_DELAYS_MS[attempt]!;
    if (delayMs > 0) await sleep(delayMs);
    const result = await replaceTaskInFileOnce(app, hintTask, updates, attempt);
    if (result.saved) {
      qmLog("replaceTaskInFile success", summarizeTask(result.updatedTask));
      return result.updatedTask ?? null;
    }
    lastFailure = result.failure ?? lastFailure;
  }

  qmFail("save gave up after retries", { lastFailure, hint: summarizeTask(hintTask) });
  new Notice(`LifeAdmin: save failed (${lastFailure}). Enable debug in settings for details.`, 6000);
  return null;
}

export async function saveTaskHappensDate(
  app: App,
  task: TasksTaskLike,
  field: HappensField,
  newDate: MomentLike,
): Promise<SaveableTask | null> {
  qmLog("saveTaskHappensDate", { field, newDate: formatDateString(newDate), task: summarizeTask(task as SaveableTask) });
  const updatedTask = await replaceTaskInFile(app, task as SaveableTask, { [field]: newDate });
  if (updatedTask) {
    new Notice(`Date set to ${formatDateString(newDate)}`, 1500);
  }
  return updatedTask;
}

export async function saveTaskFixedDateFromToday(
  app: App,
  task: TasksTaskLike,
  amount: number,
  unit: "day",
): Promise<SaveableTask | null> {
  const field = getDateFieldToPostpone(task);
  qmLog("saveTaskFixedDateFromToday", { amount, unit, field, task: summarizeTask(task as SaveableTask) });
  if (!field) {
    qmFail("no happens date on task", summarizeTask(task as SaveableTask));
    new Notice("Postponement requires a date: due, scheduled or start.");
    return null;
  }

  const momentFn = window.moment;
  const newDate = momentFn().startOf("day").add(amount, unit);
  return saveTaskHappensDate(app, task, field, newDate);
}

export async function saveTaskRelativeDate(
  app: App,
  task: TasksTaskLike,
  amount: number,
  unit: "day" | "week" | "month",
): Promise<SaveableTask | null> {
  const field = getDateFieldToPostpone(task);
  if (!field) {
    qmFail("no happens date on task", summarizeTask(task as SaveableTask));
    new Notice("Postponement requires a date: due, scheduled or start.");
    return null;
  }

  const existing = getCurrentHappensMoment(task, field);
  if (!existing) {
    qmFail("happens moment missing", { field, task: summarizeTask(task as SaveableTask) });
    new Notice("Postponement requires a date: due, scheduled or start.");
    return null;
  }

  const newDate = existing.clone().add(amount, unit);
  return saveTaskHappensDate(app, task, field, newDate);
}

export async function saveTaskPriority(app: App, task: TasksTaskLike, priorityNumber: number): Promise<SaveableTask | null> {
  qmLog("saveTaskPriority", { priorityNumber, task: summarizeTask(task as SaveableTask) });
  const updatedTask = await replaceTaskInFile(app, task as SaveableTask, { priority: String(priorityNumber) });
  if (updatedTask) {
    const label = priorityNumber === 3 ? "Priority cleared (Day)" : "Priority updated";
    new Notice(label, 1500);
  }
  return updatedTask;
}
