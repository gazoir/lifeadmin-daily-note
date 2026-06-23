import type { App } from "obsidian";

export const HIDE_LIGHTNING_CLASS = "lifeadmin-hide-lightning";
const TASKS_BLOCK_RE = /```tasks\r?\n([\s\S]*?)```/gi;
const HIDE_LIGHTNING_LINE = /^\s*#\s*hide\s+lightning\s+button\s*$/im;

export function extractTasksQueries(markdown: string): string[] {
  const queries: string[] = [];
  TASKS_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TASKS_BLOCK_RE.exec(markdown)) !== null) {
    queries.push(match[1] ?? "");
  }
  return queries;
}

export function queryHidesLightning(query: string): boolean {
  return HIDE_LIGHTNING_LINE.test(query);
}

type QueryKind = "shopping" | "daily" | "tomorrow" | "generic";

function classifyQuery(query: string): QueryKind {
  const q = query.toLowerCase();
  if (/heading includes shopping|heading includes packing|heading includes prep/.test(q)) return "shopping";
  if (/happens \d{4}-\d{2}-\d{2}/.test(q) || /sort by start date/.test(q)) return "tomorrow";
  if (/group by function/.test(q) || /heading does not include shopping/.test(q)) return "daily";
  return "generic";
}

function classifyRoot(root: HTMLElement): QueryKind {
  const headings = renderedGroupHeadings(root).join(" ");
  const text = `${headings} ${root.textContent?.toLowerCase() ?? ""}`;
  if (/shopping list|shopping|packing|prep|cleanup/.test(text)) return "shopping";
  if (/morning|after work|before lunch|early morning|overdue|day/.test(text)) return "daily";
  return "generic";
}

function getQueryTextFromEmbedRoot(root: HTMLElement): string | null {
  const code = root.querySelector("code[class*='language-tasks']");
  const text = code?.textContent?.trim();
  if (text) return text;
  const pre = root.querySelector("pre[class*='language-tasks']");
  const preText = pre?.textContent?.trim();
  return preText || null;
}

function embedRootFromTasksUl(ul: HTMLElement): HTMLElement {
  let el: HTMLElement | null = ul;
  while (el?.parentElement) {
    const parent = el.parentElement;
    if (parent.classList.contains("cm-preview-code-block")) {
      return parent;
    }
    if (parent.querySelector(":scope > .plugin-tasks-query-explanation")) {
      return parent;
    }
    if (
      parent.classList.contains("markdown-reading-view") ||
      parent.classList.contains("markdown-preview-view") ||
      parent.classList.contains("markdown-preview-sizer")
    ) {
      break;
    }
    el = parent;
  }
  return ul.parentElement ?? ul;
}

/** Unique tasks embed roots on the page, in document order. */
export function collectTasksEmbedRoots(container: ParentNode): HTMLElement[] {
  const ordered: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const tasksListSelector = "ul.plugin-tasks-query-result, ul.contains-task-list";

  container.querySelectorAll(".cm-preview-code-block").forEach((block) => {
    if (!(block instanceof HTMLElement)) return;
    if (!block.querySelector(`${tasksListSelector}, .plugin-tasks-query-explanation`)) return;
    if (!seen.has(block)) {
      seen.add(block);
      ordered.push(block);
    }
  });
  if (ordered.length > 0) return ordered;

  container.querySelectorAll(".plugin-tasks-query-explanation").forEach((pre) => {
    const root = pre.parentElement;
    if (
      root instanceof HTMLElement &&
      root.querySelector("li.plugin-tasks-list-item, ul.plugin-tasks-query-result, ul.contains-task-list") &&
      !seen.has(root)
    ) {
      seen.add(root);
      ordered.push(root);
    }
  });
  if (ordered.length > 0) return ordered;

  container.querySelectorAll(tasksListSelector).forEach((ul) => {
    if (!(ul instanceof HTMLElement)) return;
    const root = embedRootFromTasksUl(ul);
    if (!seen.has(root)) {
      seen.add(root);
      ordered.push(root);
    }
  });

  return ordered;
}

function activeMarkdownContainer(app: App): HTMLElement | null {
  const leaf = app.workspace.activeLeaf;
  const view = leaf?.view;
  if (view && "containerEl" in view && view.containerEl instanceof HTMLElement) {
    const reading = view.containerEl.querySelector(".markdown-reading-view");
    if (reading instanceof HTMLElement) return reading;
    const sizer = view.containerEl.querySelector(".cm-sizer");
    if (sizer instanceof HTMLElement) return sizer;
  }
  return (
    document.querySelector(".markdown-reading-view") ??
    document.querySelector(".cm-editor.cm-active .cm-sizer")
  );
}

function renderedGroupHeadings(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".tasks-group-heading")].map(
    (el) => el.textContent?.trim().toLowerCase() ?? "",
  );
}

/** Match embed to query by source text or rendered content — never rely on fragile index pairing. */
export function resolveQueryForRoot(root: HTMLElement, fileQueries: string[]): string {
  const fromDom = getQueryTextFromEmbedRoot(root);
  if (fromDom) return fromDom;

  if (fileQueries.length === 1) {
    return fileQueries[0] ?? "";
  }

  const headings = renderedGroupHeadings(root);
  const blob = `${headings.join(" ")} ${root.textContent?.toLowerCase() ?? ""}`;

  if (/shopping list|shopping|packing|prep list|cleanup/i.test(blob)) {
    const match = fileQueries.find((q) => /heading includes shopping|heading includes packing|heading includes prep/i.test(q));
    if (match) return match;
  }

  if (/morning|after work|before lunch|early morning|overdue|day/i.test(blob)) {
    const match = fileQueries.find(
      (q) => /group by function/i.test(q) && /heading does not include shopping/i.test(q),
    );
    if (match) return match;
  }

  const happensMatch = fileQueries.find((q) => /happens \d{4}-\d{2}-\d{2}/i.test(q));
  if (happensMatch && !/shopping list/i.test(blob) && headings.length === 0) {
    return happensMatch;
  }

  return "";
}

function resolveQueriesForRoots(roots: HTMLElement[], fileQueries: string[]): string[] {
  const resolved = new Array<string>(roots.length).fill("");
  const unused = new Set<number>(fileQueries.map((_, i) => i));

  for (let i = 0; i < roots.length; i += 1) {
    const fromDom = getQueryTextFromEmbedRoot(roots[i]);
    if (!fromDom) continue;
    resolved[i] = fromDom;
  }

  // Mark already-resolved slots as used when they exactly match a file query.
  for (const query of resolved) {
    if (!query) continue;
    const idx = fileQueries.findIndex((q) => q.trim() === query.trim());
    if (idx >= 0) unused.delete(idx);
  }

  // First pass: one-to-one kind matching (shopping/daily/tomorrow).
  for (let i = 0; i < roots.length; i += 1) {
    if (resolved[i]) continue;
    const kind = classifyRoot(roots[i]);
    if (kind === "generic") continue;
    const idx = fileQueries.findIndex((q, qIdx) => unused.has(qIdx) && classifyQuery(q) === kind);
    if (idx >= 0) {
      resolved[i] = fileQueries[idx] ?? "";
      unused.delete(idx);
    }
  }

  // Second pass: existing heuristic resolver.
  for (let i = 0; i < roots.length; i += 1) {
    if (resolved[i]) continue;
    const query = resolveQueryForRoot(roots[i], fileQueries);
    if (query) {
      resolved[i] = query;
      const idx = fileQueries.findIndex((q, qIdx) => unused.has(qIdx) && q.trim() === query.trim());
      if (idx >= 0) unused.delete(idx);
    }
  }

  // Final fallback: consume remaining queries in file order.
  const remaining = [...unused].sort((a, b) => a - b);
  let cursor = 0;
  for (let i = 0; i < roots.length; i += 1) {
    if (resolved[i]) continue;
    const idx = remaining[cursor++];
    if (idx === undefined) break;
    resolved[i] = fileQueries[idx] ?? "";
  }

  return resolved;
}

function clearHideLightningClasses(container: ParentNode): void {
  container.querySelectorAll(`.${HIDE_LIGHTNING_CLASS}`).forEach((el) => {
    el.classList.remove(HIDE_LIGHTNING_CLASS);
  });
}

function setHideLightningOnRoot(root: HTMLElement, hide: boolean): void {
  root.classList.toggle(HIDE_LIGHTNING_CLASS, hide);
  if (!hide) return;

  root.querySelectorAll(".lifeadmin-task-quick-menu").forEach((btn) => btn.remove());
  root.querySelectorAll("li.plugin-tasks-list-item[data-lifeadmin-quick-menu]").forEach((li) => {
    li.removeAttribute("data-lifeadmin-quick-menu");
  });
}

export function applyHideLightningClasses(fileQueries: string[], container: HTMLElement): void {
  clearHideLightningClasses(container);

  const roots = collectTasksEmbedRoots(container);
  const singleQueryHideAll = fileQueries.length === 1 && queryHidesLightning(fileQueries[0] ?? "");

  if (singleQueryHideAll) {
    for (const root of roots) {
      setHideLightningOnRoot(root, true);
    }
    container.querySelectorAll("ul.plugin-tasks-query-result, ul.contains-task-list").forEach((list) => {
      if (!(list instanceof HTMLElement)) return;
      const root = embedRootFromTasksUl(list);
      setHideLightningOnRoot(root, true);
    });
    return;
  }

  const resolvedQueries = resolveQueriesForRoots(roots, fileQueries);
  for (let i = 0; i < roots.length; i += 1) {
    const root = roots[i];
    const query = resolvedQueries[i] ?? "";
    setHideLightningOnRoot(root, queryHidesLightning(query));
  }
}

export async function syncHideLightningClasses(app: App): Promise<void> {
  const file = app.workspace.getActiveFile();
  if (!file) return;

  const container = activeMarkdownContainer(app);
  if (!(container instanceof HTMLElement)) return;

  const content = await app.vault.read(file);
  const queries = extractTasksQueries(content);
  applyHideLightningClasses(queries, container);
}

export async function activeFileWantsGlobalLightningHide(app: App): Promise<boolean> {
  const file = app.workspace.getActiveFile();
  if (!file) return false;
  const content = await app.vault.read(file);
  const queries = extractTasksQueries(content);
  return queries.length === 1 && queryHidesLightning(queries[0] ?? "");
}

export function isInsideHideLightningEmbed(element: HTMLElement): boolean {
  return element.closest(`.${HIDE_LIGHTNING_CLASS}`) !== null;
}
