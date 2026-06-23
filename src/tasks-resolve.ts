import type { App } from "obsidian";
import type { MomentLike, TasksTaskLike } from "./tasks-line-edit";
import { qmFail, qmLog, summarizeTask } from "./tasks-quick-menu-debug";

interface TasksPluginLike {
  getTasks?: () => ExtendedTask[];
}

export interface ExtendedTask extends TasksTaskLike {
  description?: string;
  toString?: () => string;
  originalMarkdown?: string;
  toFileLineString?: () => string;
  status?: { symbol: string };
}

export function resolveTaskFromListItem(app: App, listItem: HTMLElement): ExtendedTask | null {
  const stamped = readStampedTask(app, listItem.querySelector<HTMLElement>(".lifeadmin-task-quick-menu"));
  if (stamped && stampedMatchesDom(stamped, listItem)) return stamped;

  return matchTaskFromDom(app, listItem);
}

/** Prefer live DOM matching over button stamps — avoids stale cache after a prior save. */
export function resolveTaskForSave(app: App, button: HTMLElement): ExtendedTask | null {
  const listItem = button.closest("li.plugin-tasks-list-item");
  if (listItem instanceof HTMLElement) {
    const fromDom = matchTaskFromDom(app, listItem, true);
    if (fromDom) {
      qmLog("resolveTaskForSave via DOM", summarizeTask(fromDom));
      return fromDom;
    }
  }

  const stamped = readStampedTask(app, button);
  if (stamped && (!listItem || stampedMatchesDom(stamped, listItem as HTMLElement))) {
    qmLog("resolveTaskForSave via stamp", summarizeTask(stamped));
    return stamped;
  }

  qmFail("resolveTaskForSave failed", {
    stampPath: button.dataset.lifeadminTaskPath,
    stampLine: button.dataset.lifeadminTaskLine,
    listText: listItem ? taskTextFromListItem(listItem as HTMLElement).slice(0, 80) : null,
    taskDue: listItem instanceof HTMLElement ? listItem.dataset.taskDue : null,
    isChecked: listItem instanceof HTMLElement ? listItem.classList.contains("is-checked") : null,
  });
  return null;
}

export function resolveTaskFromButton(app: App, button: HTMLElement): ExtendedTask | null {
  const listItem = button.closest("li.plugin-tasks-list-item");
  if (listItem instanceof HTMLElement) {
    const fromDom = matchTaskFromDom(app, listItem);
    if (fromDom) return fromDom;
  }

  return readStampedTask(app, button);
}

export function stampTaskOnButton(button: HTMLElement, task: TasksTaskLike): void {
  const ext = task as ExtendedTask;
  button.dataset.lifeadminTaskPath = task.taskLocation.path;
  button.dataset.lifeadminTaskLine = String(task.taskLocation.lineNumber);
  if (ext.originalMarkdown) {
    button.dataset.lifeadminTaskMarkdown = ext.originalMarkdown;
  }
}

function readStampedTask(app: App, element: HTMLElement | null | undefined): ExtendedTask | null {
  if (!element) return null;
  const path = element.dataset.lifeadminTaskPath;
  const markdown = element.dataset.lifeadminTaskMarkdown;
  const lineRaw = element.dataset.lifeadminTaskLine;

  if (path && markdown) {
    const byMarkdown = findTaskByMarkdown(app, path, markdown);
    if (byMarkdown) return byMarkdown;
  }

  if (!path || !lineRaw) return null;
  const lineNumber = Number.parseInt(lineRaw, 10);
  if (!Number.isFinite(lineNumber)) return null;
  return findTaskByLine(app, path, lineNumber);
}

function findTaskByMarkdown(app: App, path: string, markdown: string): ExtendedTask | null {
  const tasks = getTasksPlugin(app)?.getTasks?.() ?? [];
  const matches = tasks.filter(
    (task) => pathsEqual(task.taskLocation.path, path) && task.originalMarkdown === markdown,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function findTaskByLine(app: App, path: string, lineNumber: number): ExtendedTask | null {
  const tasks = getTasksPlugin(app)?.getTasks?.() ?? [];
  return (
    tasks.find(
      (task) => pathsEqual(task.taskLocation.path, path) && task.taskLocation.lineNumber === lineNumber,
    ) ?? null
  );
}

function matchTaskFromDom(app: App, listItem: HTMLElement, verbose = false): ExtendedTask | null {
  const path = resolveTaskPath(app, listItem);
  if (verbose) {
    qmLog("matchTaskFromDom", {
      path,
      inlineTask: isInlineMarkdownTask(listItem),
      listText: taskTextFromListItem(listItem).slice(0, 80),
      taskDue: listItem.dataset.taskDue,
      taskScheduled: listItem.dataset.taskScheduled,
      isChecked: listItem.classList.contains("is-checked"),
      domLine: resolveTaskLineFromDom(listItem),
    });
  }

  if (path) {
    const domLine = resolveTaskLineFromDom(listItem);
    if (domLine !== null) {
      const byLine = findTaskByLine(app, path, domLine);
      if (byLine && filterTasksByDomSignals([byLine], listItem).length === 1) {
        if (verbose) qmLog("matchTaskFromDom by data-line", { path, domLine });
        return byLine;
      }
    }
  }

  const pool = path ? getTasksOnPath(app, path) : (getTasksPlugin(app)?.getTasks?.() ?? []);
  if (verbose) qmLog("candidate pool", { path, count: pool.length });

  let filtered = filterTasksByDomSignals(pool, listItem);
  if (filtered.length === 0 && path) {
    const globalPool = getTasksPlugin(app)?.getTasks?.() ?? [];
    if (verbose) qmLog("retrying with global pool after empty path-scoped match", { path });
    filtered = filterTasksByDomSignals(globalPool, listItem);
  }
  if (verbose) qmLog("after DOM filter", { before: pool.length, after: filtered.length });

  if (filtered.length === 0) {
    if (verbose) qmLog("matchTaskFromDom no candidates after DOM filter");
    return null;
  }

  const matched = disambiguateCandidates(app, listItem, filtered, verbose);
  if (verbose && matched) qmLog("matchTaskFromDom matched", summarizeTask(matched));
  return matched;
}

function filterTasksByDomSignals(tasks: ExtendedTask[], listItem: HTMLElement): ExtendedTask[] {
  const domDone = listItem.classList.contains("is-checked");
  const listText = taskTextFromListItem(listItem);
  const dueBucket = listItem.dataset.taskDue;
  const scheduledBucket = listItem.dataset.taskScheduled;

  return tasks.filter((task) => {
    if (isTaskDone(task) !== domDone) return false;

    if (dueBucket) {
      if (!task.dueDate?.isValid?.() || !dateMatchesBucket(task.dueDate, dueBucket)) return false;
    }

    if (scheduledBucket) {
      if (!task.scheduledDate?.isValid?.() || !dateMatchesBucket(task.scheduledDate, scheduledBucket)) {
        return false;
      }
    }

    if (listText && scoreTaskMatch(task, listText) < 30) return false;

    return true;
  });
}

function disambiguateCandidates(
  app: App,
  listItem: HTMLElement,
  candidates: ExtendedTask[],
  verbose = false,
): ExtendedTask | null {
  if (candidates.length === 1) return candidates[0]!;

  const backlinkPath = resolveBacklinkPathOnly(app, listItem);
  if (backlinkPath) {
    const onBacklink = candidates.filter((task) => pathsEqual(task.taskLocation.path, backlinkPath));
    if (onBacklink.length === 1) {
      if (verbose) qmLog("disambiguated by backlink path", { backlinkPath });
      return onBacklink[0]!;
    }
    if (onBacklink.length > 1) candidates = onBacklink;
  }

  const activePath = app.workspace.getActiveFile()?.path;
  if (activePath) {
    const onActive = candidates.filter((task) => pathsEqual(task.taskLocation.path, activePath));
    if (onActive.length === 1) {
      if (verbose) qmLog("disambiguated by active file", { activePath });
      return onActive[0]!;
    }
    if (onActive.length > 1) candidates = onActive;
  }

  const domLine = resolveTaskLineFromDom(listItem);
  if (domLine !== null) {
    const onLine = candidates.filter((task) => task.taskLocation.lineNumber === domLine);
    if (onLine.length === 1) {
      if (verbose) qmLog("disambiguated by data-line", { domLine });
      return onLine[0]!;
    }
    if (onLine.length > 1) candidates = onLine;
  }

  const contextPath =
    listItem.closest(".markdown-preview-section")?.getAttribute("data-path") ?? activePath ?? null;
  const noteDate = contextPath ? noteDateFromDailyPath(contextPath) : null;
  if (noteDate) {
    const dueOnNoteDate = candidates.filter(
      (task) => task.dueDate?.format?.("YYYY-MM-DD") === noteDate,
    );
    if (dueOnNoteDate.length === 1) {
      if (verbose) qmLog("disambiguated by due date matching daily note", { noteDate });
      return dueOnNoteDate[0]!;
    }
    if (dueOnNoteDate.length > 1) candidates = dueOnNoteDate;
  }

  const dueDatedFiles = candidates.filter((task) => {
    const due = task.dueDate?.format?.("YYYY-MM-DD");
    return due && task.taskLocation.path.includes(due);
  });
  if (dueDatedFiles.length === 1) {
    if (verbose) qmLog("disambiguated by due date in path");
    return dueDatedFiles[0]!;
  }
  if (dueDatedFiles.length > 1) candidates = dueDatedFiles;

  const recentDaily = pickMostRecentDailyNoteTask(app, candidates);
  if (recentDaily) {
    if (verbose) qmLog("disambiguated by recent daily note mtime", summarizeTask(recentDaily));
    return recentDaily;
  }

  const listText = taskTextFromListItem(listItem);
  const scored = candidates
    .map((task) => ({ task, score: scoreTaskMatch(task, listText) }))
    .filter((entry) => entry.score >= 30)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    qmFail("ambiguous task match", {
      count: candidates.length,
      samples: candidates.slice(0, 3).map((task) => summarizeTask(task)),
    });
    return null;
  }

  const topScore = scored[0]!.score;
  const topMatches = scored.filter((entry) => entry.score === topScore);
  if (topMatches.length === 1) return topMatches[0]!.task;

  qmFail("ambiguous task match", {
    count: candidates.length,
    topScore,
    samples: topMatches.slice(0, 3).map((entry) => summarizeTask(entry.task)),
  });
  return null;
}

function stampedMatchesDom(task: ExtendedTask, listItem: HTMLElement): boolean {
  return filterTasksByDomSignals([task], listItem).length === 1;
}

function isTaskDone(task: ExtendedTask): boolean {
  const symbol = task.status?.symbol ?? " ";
  return symbol.trim() !== "" && symbol !== " ";
}

function dateMatchesBucket(date: MomentLike, bucket: string): boolean {
  const today = window.moment().startOf("day");
  const target = date.clone().startOf("day");
  const diffDays = today.diff(target, "days");

  if (bucket === "today") return diffDays === 0;

  const pastMatch = bucket.match(/^past-(\d+)d$/);
  if (pastMatch) return diffDays === Number.parseInt(pastMatch[1]!, 10);

  const futureMatch = bucket.match(/^future-(\d+)d$/);
  if (futureMatch) return diffDays === -Number.parseInt(futureMatch[1]!, 10);

  if (bucket === "past-far") return diffDays > 7;
  if (bucket === "future-far") return diffDays < -7;

  return true;
}

function getTasksPlugin(app: App): TasksPluginLike | null {
  const plugin = app.plugins.plugins["obsidian-tasks-plugin"] as TasksPluginLike | undefined;
  return plugin?.getTasks ? plugin : null;
}

function getTasksOnPath(app: App, path: string): ExtendedTask[] {
  const tasks = getTasksPlugin(app)?.getTasks?.() ?? [];
  return tasks.filter((task) => pathsEqual(task.taskLocation.path, path));
}

function taskTextFromListItem(listItem: HTMLElement): string {
  const textEl = listItem.querySelector(".tasks-list-text");
  const raw = textEl?.textContent ?? listItem.textContent ?? "";
  return normalizeForMatch(raw);
}

function resolveTaskPath(app: App, listItem: HTMLElement): string | null {
  const hasBacklinkContainer = listItem.querySelector(".tasks-backlink") !== null;
  const backlinkPath = resolveBacklinkPathOnly(app, listItem);
  if (backlinkPath) return backlinkPath;
  if (hasBacklinkContainer) return null;

  const inQuery = listItem.closest("ul.plugin-tasks-query-result") !== null;
  if (inQuery) {
    // Tasks omits the backlink when the task lives in the same file as the query block.
    const activePath = app.workspace.getActiveFile()?.path;
    if (activePath) return activePath;
    return null;
  }

  const sectionPath = listItem.closest(".markdown-preview-section")?.getAttribute("data-path");
  if (sectionPath) return sectionPath;

  const activePath = app.workspace.getActiveFile()?.path;
  if (activePath && isInlineMarkdownTask(listItem)) return activePath;

  return null;
}

function resolveBacklinkPathOnly(app: App, listItem: HTMLElement): string | null {
  const backlinkEl = listItem.querySelector<HTMLAnchorElement>(".tasks-backlink a.internal-link");
  const href = backlinkEl?.getAttribute("href") ?? backlinkEl?.dataset.href ?? null;
  if (href) {
    const resolved = resolveHrefToPath(app, href);
    if (resolved) return resolved;
  }

  const backlinkContainer = listItem.querySelector(".tasks-backlink");
  if (backlinkContainer) {
    return resolveBacklinkTextToPath(app, backlinkContainer.textContent?.trim() ?? "");
  }

  return null;
}

function resolveBacklinkTextToPath(app: App, label: string): string | null {
  if (!label) return null;
  const sourcePath = app.workspace.getActiveFile()?.path ?? "";
  const dest = app.metadataCache.getFirstLinkpathDest(label, sourcePath);
  return dest?.path ?? null;
}

function isInlineMarkdownTask(listItem: HTMLElement): boolean {
  return (
    listItem.closest("ul.contains-task-list") !== null &&
    listItem.closest("ul.plugin-tasks-query-result") === null
  );
}

function resolveTaskLineFromDom(listItem: HTMLElement): number | null {
  const raw = listItem.dataset.line;
  if (raw === undefined || raw === "") return null;
  const line = Number.parseInt(raw, 10);
  return Number.isFinite(line) ? line : null;
}

function noteDateFromDailyPath(path: string): string | null {
  const match = path.match(/Diaries\/(\d{4}-\d{2}-\d{2})\.md$/i);
  return match?.[1] ?? null;
}

function pickMostRecentDailyNoteTask(app: App, candidates: ExtendedTask[]): ExtendedTask | null {
  const daily = candidates.filter((task) => noteDateFromDailyPath(task.taskLocation.path));
  if (daily.length <= 1) return null;

  let best: ExtendedTask | null = null;
  let bestMtime = -1;
  for (const task of daily) {
    const file = app.vault.getAbstractFileByPath(task.taskLocation.path);
    const mtime = file && "stat" in file ? file.stat.mtime : 0;
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = task;
    }
  }
  return bestMtime >= 0 ? best : null;
}

function resolveHrefToPath(app: App, href: string): string | null {
  const sourcePath = app.workspace.getActiveFile()?.path ?? "";
  const dest = app.metadataCache.getFirstLinkpathDest(href, sourcePath);
  if (dest?.path) return dest.path;

  const normalizedHref = href.replace(/^\.\//, "");
  if (app.vault.getAbstractFileByPath(normalizedHref)) return normalizedHref;
  const withMd = normalizedHref.endsWith(".md") ? normalizedHref : `${normalizedHref}.md`;
  if (app.vault.getAbstractFileByPath(withMd)) return withMd;
  return normalizedHref;
}

function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "").toLowerCase();
}

function scoreTaskMatch(task: ExtendedTask, listText: string): number {
  const candidates = [task.description ?? "", task.toString?.() ?? "", task.originalMarkdown ?? ""].map(
    normalizeForMatch,
  );

  let best = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === listText) return 100;
    if (listText.includes(candidate)) best = Math.max(best, 80);
    else if (candidate.includes(listText)) best = Math.max(best, 60);
    else {
      const words = candidate.split(" ").filter((w) => w.length > 2);
      const hits = words.filter((w) => listText.includes(w)).length;
      if (words.length > 0) best = Math.max(best, Math.round((hits / words.length) * 50));
    }
  }
  return best;
}

function normalizeForMatch(text: string): string {
  return stripMarkdownLinks(text)
    .replace(/`[^`]*`/g, " ")
    .replace(/\$=\s*[^`]+`?/g, " ")
    .replace(/🔺|⏫|🔼|🔽|⏬/g, "")
    .replace(/📅|📆|🗓|⏳|⌛|🛫|✅|🔁|⛔|🆔|🔗|0️⃣|📔|📰|🟪|🧇|🦉|🥋/g, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\b\d{1,2}\s+[a-z]{3}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripMarkdownLinks(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_, path: string) => path.split("/").pop() ?? path);
}
