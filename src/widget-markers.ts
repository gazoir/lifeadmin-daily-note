import { App, MarkdownView, TFile } from "obsidian";
import { DAILY_NOTE_PATH_RE } from "./daily-notes";
import { PROJECT_HEADER_END } from "./project-header";
import { WidgetName, widgetMarkers } from "./utils";

const vaultFileQueues = new Map<string, Promise<void>>();

/** Serialize vault read/modify cycles per file so parallel widget refreshes cannot clobber each other. */
export function enqueueVaultFileMutation<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = vaultFileQueues.get(path) ?? Promise.resolve();
  const result = prev.catch(() => {}).then(fn);
  vaultFileQueues.set(
    path,
    result.then(
      () => {},
      () => {},
    ),
  );
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function waitForWidgetMarkers(
  app: App,
  file: TFile,
  widgets: WidgetName[],
  timeoutMs = 60000,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const content = await app.vault.read(file);
      if (widgets.every((widget) => hasWidgetMarkers(content, widget))) return true;
    } catch {
      return false;
    }
    await sleep(100);
  }
  return false;
}

export function widgetInnerShowsDeferredPlaceholder(inner: string | null): boolean {
  if (!inner) return false;
  return (
    /Loading weather/i.test(inner) ||
    /Loading habits/i.test(inner) ||
    /Loading calendar/i.test(inner) ||
    /dashboard-weather-bar--loading/i.test(inner)
  );
}

export function stripLegacyGcalNavLine(content: string): string {
  return content.replace(/^#{1,6}\s+\[\[[^\n]*⬅️ Previous\]\][^\n]*\n+/m, "");
}

/** Wrap weight + habits markers in a shared flex row when missing (legacy daily notes). */
export function ensureWeightHabitsRow(content: string): string {
  if (content.includes("dashboard-weight-habits-row")) return content;

  const weightStart = content.indexOf("<!-- dashboard:weight:start -->");
  if (weightStart < 0) return content;

  const habitsEndMarker = "<!-- dashboard:habits:end -->";
  const habitsEnd = content.indexOf(habitsEndMarker, weightStart);
  if (habitsEnd < 0) return content;

  const endPos = habitsEnd + habitsEndMarker.length;
  const inner = content.slice(weightStart, endPos);
  const wrapped = `<div class="dashboard-weight-habits-row">\n${inner}\n</div>`;
  return content.slice(0, weightStart) + wrapped + content.slice(endPos);
}

export function hasWidgetMarkers(content: string, widget: WidgetName): boolean {
  const { start, end } = widgetMarkers(widget);
  const startIdx = content.indexOf(start);
  if (startIdx < 0) return false;
  return content.indexOf(end, startIdx + start.length) >= 0;
}

export function extractWidgetInnerFromFile(content: string, widget: WidgetName): string | null {
  const { start, end } = widgetMarkers(widget);
  const startIdx = content.indexOf(start);
  if (startIdx < 0) return null;
  const endIdx = content.indexOf(end, startIdx + start.length);
  if (endIdx < 0) return null;
  return content.slice(startIdx + start.length, endIdx).trim();
}

export function findGbOnlineDailyInsertPoint(content: string): number | null {
  const tomorrowIdx = content.indexOf("> [!tomorrow]");
  const searchEnd = tomorrowIdx >= 0 ? tomorrowIdx : content.length;

  const projectEnd = content.lastIndexOf(PROJECT_HEADER_END, searchEnd);
  if (projectEnd >= 0) return projectEnd + PROJECT_HEADER_END.length;

  const gcalEndMarker = "<!-- dashboard:gcal:end -->";
  const gcalEnd = content.lastIndexOf(gcalEndMarker, searchEnd);
  if (gcalEnd >= 0) return gcalEnd + gcalEndMarker.length;

  return null;
}

function applyWidgetReplacement(raw: string, widget: WidgetName, innerHtml: string): string | null {
  const { start, end } = widgetMarkers(widget);
  const startIdx = raw.indexOf(start);
  if (startIdx < 0) return null;
  const endIdx = raw.indexOf(end, startIdx + start.length);
  if (endIdx < 0) return null;
  const replacement = `${start}\n${innerHtml}\n${end}`;
  return raw.slice(0, startIdx) + replacement + raw.slice(endIdx + end.length);
}

function insertWidgetBlock(raw: string, insertAt: number, widget: WidgetName, innerHtml: string): string {
  const { start, end } = widgetMarkers(widget);
  const block = `${start}\n${innerHtml}\n${end}`;
  const before = raw.slice(0, insertAt).replace(/\n+$/, "");
  const after = raw.slice(insertAt).replace(/^\n+/, "");
  return `${before}\n\n${block}\n\n${after}`;
}

function transformWidgetContent(raw: string, file: TFile, widget: WidgetName, innerHtml: string): string | null {
  const replaced = applyWidgetReplacement(raw, widget, innerHtml);
  if (replaced) return replaced;

  if (widget === "gb-online-daily" && DAILY_NOTE_PATH_RE.test(file.path)) {
    const insertAt = findGbOnlineDailyInsertPoint(raw);
    if (insertAt !== null) return insertWidgetBlock(raw, insertAt, widget, innerHtml);
  }

  return null;
}

export async function replaceWidgetInFile(
  app: App,
  file: TFile,
  widget: WidgetName,
  innerHtml: string,
): Promise<void> {
  await enqueueVaultFileMutation(file.path, async () => {
    let raw = await app.vault.read(file);
    if (widget === "weight" || widget === "habits") {
      const rowWrapped = ensureWeightHabitsRow(raw);
      if (rowWrapped !== raw) {
        await app.vault.modify(file, rowWrapped);
        raw = rowWrapped;
      }
    }

    const updated = transformWidgetContent(raw, file, widget, innerHtml);
    if (!updated) {
      throw new Error(`Dashboard markers not found for widget: ${widget}`);
    }

    await app.vault.modify(file, updated);
    syncOpenMarkdownViews(app, file, (viewRaw) => transformWidgetContent(viewRaw, file, widget, innerHtml));
  });
}

/** Update widget HTML in the vault only — does not call setViewData on open editors. */
export async function replaceWidgetInVaultOnly(
  app: App,
  file: TFile,
  widget: WidgetName,
  innerHtml: string,
): Promise<void> {
  await enqueueVaultFileMutation(file.path, async () => {
    const raw = await app.vault.read(file);
    const updated = transformWidgetContent(raw, file, widget, innerHtml);
    if (!updated) {
      throw new Error(`Dashboard markers not found for widget: ${widget}`);
    }
    if (updated !== raw) await app.vault.modify(file, updated);
  });
}

function syncOpenMarkdownViews(
  app: App,
  file: TFile,
  transform: (raw: string) => string | null,
): void {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || view.file !== file) continue;
    const viewRaw = view.getViewData();
    const viewUpdated = transform(viewRaw);
    if (viewUpdated && viewUpdated !== viewRaw) {
      view.setViewData(viewUpdated, false);
    }
  }
}
