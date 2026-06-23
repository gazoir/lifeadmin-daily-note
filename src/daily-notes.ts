import { TFile, type App, type Plugin } from "obsidian";
import { setDeferNetworkBakes } from "./bake-mode";
import { runTemplaterOnFile } from "./templater-run";
import { waitForWidgetMarkers } from "./widget-markers";
import type { WidgetName } from "./utils";

export const DEFAULT_DAILY_TEMPLATE_PATH = "Templates/Formatting/TEM_Daily Note.md";
export const DAILY_NOTE_PATH_RE = /^Diaries\/(\d{4}-\d{2}-\d{2})\.md$/;

const processing = new Set<string>();
const inflight = new Map<string, Promise<void>>();

export interface OpenDailyDiaryOptions {
  afterTemplate?: (file: TFile) => Promise<void>;
}

export type DeferredDailyWidgetsRefresh = (app: App, file: TFile) => Promise<void>;

let deferredDailyWidgetsRefresh: DeferredDailyWidgetsRefresh | null = null;

export function registerDeferredDailyWidgetsRefresh(fn: DeferredDailyWidgetsRefresh | null): void {
  deferredDailyWidgetsRefresh = fn;
}

function triggerDeferredDailyWidgetsRefresh(app: App, file: TFile): void {
  if (!deferredDailyWidgetsRefresh) return;
  const deferredWidgets: WidgetName[] = ["weather", "habits", "gcal"];
  void (async () => {
    const ready = await waitForWidgetMarkers(app, file, deferredWidgets, 90000);
    if (!ready) {
      console.warn("LifeAdmin: deferred widget refresh skipped — dashboard markers not ready");
      return;
    }
    try {
      await deferredDailyWidgetsRefresh!(app, file);
    } catch (e) {
      console.warn("LifeAdmin: deferred dashboard refresh failed:", e);
      window.setTimeout(() => {
        void deferredDailyWidgetsRefresh!(app, file).catch((retryErr) => {
          console.warn("LifeAdmin: deferred dashboard refresh retry failed:", retryErr);
        });
      }, 2500);
    }
  })();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function dailyNotePath(dateYmd: string): string {
  return `Diaries/${dateYmd}.md`;
}

export function parseDailyDiaryLink(href: string): string | null {
  const path = href.trim().replace(/\.md$/i, "");
  const m = path.match(/(?:^|\/)Diaries\/(\d{4}-\d{2}-\d{2})$/);
  return m?.[1] ?? null;
}

export function resolveDailyDiaryNavDate(el: HTMLElement): string | null {
  const nav = el.closest<HTMLElement>(".dashboard-gcal-nav-btn[data-date]");
  if (!nav) return null;
  const fromData = nav.dataset.date?.trim();
  if (fromData && /^\d{4}-\d{2}-\d{2}$/.test(fromData)) return fromData;
  const href = nav.dataset.href ?? nav.getAttribute("href") ?? "";
  return parseDailyDiaryLink(href);
}

function hasUnparsedTemplater(body: string): boolean {
  return /<%[\*=]/.test(body);
}

function hasDailyNoteStructure(body: string): boolean {
  if (/^##\s/m.test(body)) return true;
  if (/\[!header\]/i.test(body)) return true;
  if (/>\s*\[!tasks\]/i.test(body)) return true;
  if (/<!-- dashboard:\w+:start -->/.test(body)) return true;
  if (/prep-button-row/.test(body)) return true;
  return false;
}

/** True when a Diaries/YYYY-MM-DD note was not fully templated (e.g. Templater aborted mid-run). */
export function isIncompleteDailyNote(content: string): boolean {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return true;

  const body = normalized.replace(/^---[\s\S]*?---\n?/, "").trim();
  if (!body) return true;
  if (!/\bdailynote\b/.test(normalized)) return true;
  if (hasUnparsedTemplater(body)) return true;
  if (!hasDailyNoteStructure(body)) return true;

  return false;
}

async function loadDailyTemplateBody(app: App, templatePath: string): Promise<string> {
  const templateFile = app.vault.getAbstractFileByPath(templatePath);
  if (!(templateFile instanceof TFile)) {
    throw new Error(`Daily note template not found: ${templatePath}`);
  }
  return app.vault.read(templateFile);
}

function isTemplaterPending(app: App, path: string): boolean {
  const tp = app.plugins.plugins["templater-obsidian"] as
    | { templater?: { files_with_pending_templates?: Set<string> } }
    | undefined;
  return tp?.templater?.files_with_pending_templates?.has(path) ?? false;
}

async function waitForCompleteDailyNote(app: App, file: TFile, timeoutMs = 60000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isTemplaterPending(app, file.path)) {
      try {
        const content = await app.vault.read(file);
        if (!isIncompleteDailyNote(content)) return true;
      } catch {
        return false;
      }
    }
    await sleep(100);
  }
  return false;
}

async function runDailyTemplateOnFile(app: App, file: TFile, templateBody: string): Promise<void> {
  const current = await app.vault.read(file);
  if (current !== templateBody) {
    await app.vault.modify(file, templateBody);
  }
  setDeferNetworkBakes(true);
  try {
    await runTemplaterOnFile(app, file);
  } finally {
    setDeferNetworkBakes(false);
  }
}

/** True when the daily template was applied (note was incomplete on entry). */
async function ensureDailyNoteContent(
  app: App,
  file: TFile,
  templatePath: string,
): Promise<boolean> {
  const content = await app.vault.read(file);
  if (!isIncompleteDailyNote(content)) return false;

  const templateBody = await loadDailyTemplateBody(app, templatePath);

  await runDailyTemplateOnFile(app, file, templateBody);
  if (await waitForCompleteDailyNote(app, file)) return true;

  // One retry after a failed/partial Templater run.
  await runDailyTemplateOnFile(app, file, templateBody);
  if (await waitForCompleteDailyNote(app, file)) return true;

  throw new Error("Daily note template did not apply. Check the Templater console for errors.");
}

export async function applyDailyNoteTemplate(
  app: App,
  file: TFile,
  templatePath = DEFAULT_DAILY_TEMPLATE_PATH,
  options?: OpenDailyDiaryOptions,
): Promise<void> {
  if (processing.has(file.path)) return;
  processing.add(file.path);
  let templated = false;
  try {
    templated = await ensureDailyNoteContent(app, file, templatePath);
  } finally {
    processing.delete(file.path);
  }
  if (templated) triggerDeferredDailyWidgetsRefresh(app, file);
  if (options?.afterTemplate) {
    await options.afterTemplate(file);
  }
}

async function openDailyDiaryInner(
  app: App,
  dateYmd: string,
  templatePath: string,
  options?: OpenDailyDiaryOptions,
): Promise<void> {
  const path = dailyNotePath(dateYmd);
  const templateBody = await loadDailyTemplateBody(app, templatePath);
  let file = app.vault.getAbstractFileByPath(path);

  processing.add(path);
  try {
    if (!(file instanceof TFile)) {
      // Seed the file with template source (same pattern as project notes).
      // Empty files + write_template_to_file only left partial frontmatter when Templater aborted.
      file = await app.vault.create(path, templateBody);
    }

    await app.workspace.getLeaf(false).openFile(file);
    const templated = await ensureDailyNoteContent(app, file, templatePath);
    if (templated) triggerDeferredDailyWidgetsRefresh(app, file);
  } finally {
    processing.delete(path);
  }

  if (options?.afterTemplate) {
    const content = await app.vault.read(file);
    if (!isIncompleteDailyNote(content)) {
      await options.afterTemplate(file);
    }
  }
}

export async function openDailyDiary(
  app: App,
  dateYmd: string,
  templatePath = DEFAULT_DAILY_TEMPLATE_PATH,
  options?: OpenDailyDiaryOptions,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    throw new Error(`Invalid daily note date: ${dateYmd}`);
  }

  const path = dailyNotePath(dateYmd);
  const existing = inflight.get(path);
  if (existing) {
    await existing;
    return;
  }

  const task = openDailyDiaryInner(app, dateYmd, templatePath, options);
  inflight.set(path, task);
  try {
    await task;
  } finally {
    inflight.delete(path);
  }
}

export function registerIncompleteDailyNoteRepair(
  plugin: Plugin,
  templatePath = DEFAULT_DAILY_TEMPLATE_PATH,
): void {
  plugin.registerEvent(
    plugin.app.vault.on("create", (abstract) => {
      if (!(abstract instanceof TFile)) return;
      if (!DAILY_NOTE_PATH_RE.test(abstract.path)) return;

      window.setTimeout(() => {
        void (async () => {
          try {
            if (processing.has(abstract.path) || inflight.has(abstract.path)) return;
            const file = plugin.app.vault.getAbstractFileByPath(abstract.path);
            if (!(file instanceof TFile)) return;
            const content = await plugin.app.vault.read(file);
            if (!isIncompleteDailyNote(content)) return;
            await applyDailyNoteTemplate(plugin.app, file, templatePath);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("ENOENT")) return;
            console.warn("LifeAdmin: daily note repair failed:", e);
          }
        })();
      }, 1500);
    }),
  );
}

export async function shouldWriteBakeFrontmatter(app: App, file: TFile): Promise<boolean> {
  try {
    if (!DAILY_NOTE_PATH_RE.test(file.path)) return true;
    const content = await app.vault.read(file);
    return !isIncompleteDailyNote(content);
  } catch {
    return false;
  }
}
