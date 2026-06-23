import { TFile, type App } from "obsidian";

export const SHOPPING_LIST_HEADING = "# 🛒 Shopping List";
export const DEFAULT_SHOPPING_LIST_PATH = "Z_Personal admin/Domestic God/Shopping List.md";
const EMPTY_TASK_LINE = "- [ ] ";

export function resolveShoppingListFile(app: App, path = DEFAULT_SHOPPING_LIST_PATH): TFile | null {
  const direct = app.vault.getAbstractFileByPath(path);
  if (direct instanceof TFile) return direct;

  const linked = app.metadataCache.getFirstLinkpathDest("Shopping List", "");
  return linked instanceof TFile ? linked : null;
}

export function shoppingListSectionBody(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let inSection = false;
  const body: string[] = [];

  for (const line of lines) {
    if (/^# 🛒 Shopping List\s*$/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^# /.test(line)) break;
    if (inSection) body.push(line);
  }

  return body.join("\n").trim();
}

export function shoppingListSectionHasIncompleteTasks(content: string): boolean {
  const body = shoppingListSectionBody(content);
  if (!body) return false;
  return body.split("\n").some((line) => /^\s*-\s*\[\s*\]/.test(line));
}

export function findShoppingListHeadingLine(lines: string[]): number {
  return lines.findIndex((line) => /^# 🛒 Shopping List\s*$/.test(line));
}

export function findEmptyTaskLineAfterHeading(lines: string[], headingLine: number): number | null {
  for (let i = headingLine + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^# /.test(trimmed)) break;
    if (!trimmed) continue;
    if (/^-\s*\[\s*\]\s*$/.test(trimmed)) return i;
    return null;
  }
  return null;
}

export async function insertShoppingListTaskAndGetLine(app: App, file: TFile): Promise<number> {
  const content = await app.vault.read(file);
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const headingLine = findShoppingListHeadingLine(lines);
  if (headingLine < 0) {
    throw new Error("Could not find 🛒 Shopping List heading.");
  }

  const existingEmpty = findEmptyTaskLineAfterHeading(lines, headingLine);
  if (existingEmpty !== null) return existingEmpty;

  const insertAt = headingLine + 1;
  lines.splice(insertAt, 0, EMPTY_TASK_LINE);
  await app.vault.modify(file, lines.join("\n"));
  return insertAt;
}

export async function focusShoppingListTaskLine(app: App, file: TFile, line: number): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, { eState: { line } });

  window.setTimeout(() => {
    const editor = app.workspace.activeEditor?.editor;
    if (!editor || editor.file?.path !== file.path) return;
    const ch = EMPTY_TASK_LINE.length;
    editor.setCursor({ line, ch });
    editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch } }, true);
    editor.focus();
  }, 120);
}

export async function syncShoppingCalloutVisibility(
  app: App,
  shoppingListPath = DEFAULT_SHOPPING_LIST_PATH,
): Promise<void> {
  const file = resolveShoppingListFile(app, shoppingListPath);
  let hasItems = false;
  if (file) {
    try {
      hasItems = shoppingListSectionHasIncompleteTasks(await app.vault.read(file));
    } catch {
      hasItems = false;
    }
  }

  for (const callout of document.querySelectorAll<HTMLElement>(".callout[data-callout='shopping']")) {
    callout.classList.add("dashboard-shopping-callout-ready");
    callout.classList.toggle("dashboard-shopping-callout-hidden", !hasItems);
    callout.classList.remove("is-collapsed");
  }
}

export function isShoppingListFile(app: App, file: TFile, shoppingListPath: string): boolean {
  return resolveShoppingListFile(app, shoppingListPath)?.path === file.path;
}
