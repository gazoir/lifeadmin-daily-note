import { MarkdownView, type App, type TFile } from "obsidian";
import { applyGbDailyWidgetExpanded } from "./gb-online-daily";
import { replaceWidgetInVaultOnly } from "./widget-markers";

const WIDGET_SELECTOR = ".dashboard-gb-daily-widget[data-widget='gb-online-daily']";

const pendingVaultHtml = new Map<string, string>();

export function queueGbDailyVaultWrite(path: string, innerHtml: string): void {
  pendingVaultHtml.set(path, innerHtml);
}

export function clearGbDailyVaultPending(path: string): void {
  pendingVaultHtml.delete(path);
}

export async function flushGbDailyVaultWrite(app: App, file: TFile): Promise<void> {
  const innerHtml = pendingVaultHtml.get(file.path);
  if (!innerHtml) return;
  pendingVaultHtml.delete(file.path);
  await replaceWidgetInVaultOnly(app, file, "gb-online-daily", innerHtml);
}

/** Queue widget HTML and write to the daily note immediately (for cross-device sync). */
export async function persistGbDailyHtmlToVault(app: App, file: TFile, innerHtml: string): Promise<void> {
  queueGbDailyVaultWrite(file.path, innerHtml);
  await flushGbDailyVaultWrite(app, file);
}

export async function flushAllGbDailyVaultWrites(app: App): Promise<void> {
  for (const path of [...pendingVaultHtml.keys()]) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await flushGbDailyVaultWrite(app, file);
  }
}

function sectionPathSelector(filePath: string): string {
  const escaped = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `.markdown-preview-section[data-path="${escaped}"]`;
}

export function findGbDailyWidgetRoots(app: App, file: TFile): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const add = (el: Element | null | undefined): void => {
    if (!(el instanceof HTMLElement) || seen.has(el)) return;
    seen.add(el);
    roots.push(el);
  };

  document.querySelectorAll<HTMLElement>(`${sectionPathSelector(file.path)} ${WIDGET_SELECTOR}`).forEach(add);

  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || view.file?.path !== file.path) continue;
    const searchRoots = [view.containerEl, view.contentEl];
    const preview = (view as MarkdownView & { previewMode?: { containerEl?: HTMLElement } }).previewMode?.containerEl;
    if (preview) searchRoots.push(preview);
    for (const container of searchRoots) {
      container?.querySelectorAll<HTMLElement>(WIDGET_SELECTOR).forEach(add);
    }
  }

  return roots;
}

export function replaceGbDailyWidgetInViews(
  app: App,
  file: TFile,
  innerHtml: string,
  expanded: boolean,
): HTMLElement[] {
  const wrap = document.createElement("div");
  wrap.innerHTML = innerHtml.trim();
  const template = wrap.querySelector<HTMLElement>(".dashboard-gb-daily-widget");
  if (!template) return [];

  const replaced: HTMLElement[] = [];
  for (const root of findGbDailyWidgetRoots(app, file)) {
    const clone = template.cloneNode(true) as HTMLElement;
    applyGbDailyWidgetExpanded(clone, expanded);
    root.replaceWith(clone);
    replaced.push(clone);
  }
  return replaced;
}

export function patchGbDailyPlaylistOpen(widget: HTMLElement, open: boolean): boolean {
  const playlist = widget.querySelector<HTMLElement>(".dashboard-gb-daily-playlist");
  if (!playlist) return false;
  widget.classList.toggle("is-playlist-open", open);
  playlist.classList.toggle("is-open", open);
  if (open) playlist.removeAttribute("hidden");
  else playlist.setAttribute("hidden", "");
  return true;
}
