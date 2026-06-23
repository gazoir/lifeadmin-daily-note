import { App, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import type { DashboardActions } from "./actions";
import { debugProject } from "./debug";
import type { ProjectActions } from "./projects";
import type { LifeAdminSettings } from "./settings";
import type { WidgetName } from "./utils";
import { openDailyDiary, resolveDailyDiaryNavDate, type OpenDailyDiaryOptions } from "./daily-notes";
import { syncShoppingCalloutVisibility } from "./shopping-list";
import { isDailyNotePath, scheduleWeeklyDayEmbedPass } from "./weekly-embed";
import { setDailyOpenSeries, setSessionDailyWidgetExpanded, setDailyWidgetExpanded, applyGbDailyWidgetExpanded, restoreGbDailyWidgetExpandedFromSession } from "./gb-online-daily";
import { resolveGbLogoUrl } from "./gb-logo";

type LifeAdminPluginLike = Plugin & {
  actions: DashboardActions;
  projects: ProjectActions;
  settings: LifeAdminSettings;
};

const HANDLED = Symbol("lifeadminHandled");
const ACTIVATION_COOLDOWN_MS = 500;
const TAP_MOVE_THRESHOLD_PX = 12;
const lastActivationByEl = new WeakMap<HTMLElement, number>();

function dailyDiaryOptions(_plugin: LifeAdminPluginLike): OpenDailyDiaryOptions {
  return {};
}

interface TapStart {
  x: number;
  y: number;
}

const tapStartByEl = new WeakMap<HTMLElement, TapStart>();

function isCoarsePointer(evt: Event): boolean {
  const pe = evt as PointerEvent;
  if (pe.pointerType === "touch" || pe.pointerType === "pen") return true;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

function recordTapStart(evt: Event): void {
  const pe = evt as PointerEvent;
  const el = (evt.target as HTMLElement).closest<HTMLElement>("[data-action], .dashboard-project-add");
  if (!el) return;
  tapStartByEl.set(el, { x: pe.clientX, y: pe.clientY });
}

function tapMovedTooFar(el: HTMLElement, evt: Event): boolean {
  if (!isCoarsePointer(evt)) return false;
  const start = tapStartByEl.get(el);
  tapStartByEl.delete(el);
  if (!start) return true;
  const point = evt as PointerEvent & MouseEvent;
  const dx = point.clientX - start.x;
  const dy = point.clientY - start.y;
  return dx * dx + dy * dy > TAP_MOVE_THRESHOLD_PX * TAP_MOVE_THRESHOLD_PX;
}

function shouldActivate(el: HTMLElement, evt: Event): boolean {
  if (evt.type === "pointerup") {
    const pe = evt as PointerEvent;
    if (pe.pointerType !== "mouse") return false;
    if (pe.button !== 0) return false;
  }
  if (evt.type === "click" && tapMovedTooFar(el, evt)) return false;

  const now = Date.now();
  const last = lastActivationByEl.get(el) ?? 0;
  if (now - last < ACTIVATION_COOLDOWN_MS) return false;
  lastActivationByEl.set(el, now);
  return true;
}

function prepareActionElement(el: HTMLElement): void {
  el.style.touchAction = "manipulation";
  if (el instanceof HTMLButtonElement || el.dataset.action) {
    el.style.cursor = "pointer";
  }
}

function asWidgetName(v: string | undefined): WidgetName | null {
  return v === "weather" || v === "hevy" || v === "weight" || v === "habits" || v === "gcal" || v === "gb-online-prototype" || v === "gb-online-daily"
    ? v
    : null;
}

function resolveAction(el: HTMLElement): string | null {
  const action = el.dataset.action?.trim();
  if (action) return action;
  if (el.classList.contains("dashboard-project-add")) return "project-create-open";
  return null;
}

function actionNeedsFile(action: string): boolean {
  return (
    action !== "project-create-open" &&
    action !== "weather-click" &&
    action !== "gcal-auth-open" &&
    action !== "daily-diary-open" &&
    action !== "shopping-quick-add"
  );
}

function fileFromClick(app: App, el: HTMLElement, sourcePath?: string): TFile | null {
  if (sourcePath) {
    const fromPath = app.vault.getAbstractFileByPath(sourcePath);
    if (fromPath instanceof TFile) return fromPath;
  }

  const sectionPath = el.closest(".markdown-preview-section")?.getAttribute("data-path");
  if (sectionPath) {
    const fromSection = app.vault.getAbstractFileByPath(sectionPath);
    if (fromSection instanceof TFile) return fromSection;
  }

  const getLeafFromDOM = (app.workspace as { getLeafFromDOM?: (node: HTMLElement) => { view?: { file?: TFile } } | null })
    .getLeafFromDOM;
  if (typeof getLeafFromDOM === "function") {
    const view = getLeafFromDOM.call(app.workspace, el)?.view;
    if (view?.file instanceof TFile) return view.file;
  }

  const leafEl = el.closest(".workspace-leaf");
  if (leafEl) {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (leaf.containerEl === leafEl) {
        const view = leaf.view as { file?: TFile };
        if (view.file instanceof TFile) return view.file;
      }
    }
  }

  const active = app.workspace.getActiveFile();
  return active instanceof TFile ? active : null;
}

function isDashboardClickTarget(el: HTMLElement): boolean {
  return Boolean(el.closest(".workspace-leaf-content, .markdown-preview-view, .markdown-reading-view, .markdown-rendered"));
}

function describeElement(el: HTMLElement): Record<string, unknown> {
  return {
    tag: el.tagName,
    classes: el.className,
    action: el.dataset.action ?? null,
    bound: el.dataset.dashboardBound ?? null,
    path: el.closest(".markdown-preview-section")?.getAttribute("data-path") ?? null,
    parents: el.parentElement?.className ?? null,
  };
}

function isProjectDebugTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  return Boolean(el.closest(".dashboard-project-add, [data-action='project-create-open']"));
}

async function runDashboardAction(
  plugin: LifeAdminPluginLike,
  action: string,
  target: HTMLElement,
  file: TFile | null,
): Promise<void> {
  if (action === "project-create-open") {
    debugProject(plugin.settings.debugProjectButton, "runDashboardAction → project-create-open", {
      hasProjects: Boolean(plugin.projects),
      hasOpenModal: typeof plugin.projects?.openCreateFromCalendarModal === "function",
      file: file?.path ?? null,
    });
  }

  if (action === "refresh") {
    if (!file) throw new Error("No note file for widget refresh.");
    const widget = asWidgetName(target.dataset.widget);
    if (widget) await plugin.actions.refreshWidget(file, widget);
    return;
  }
  if (action === "dashboard-refresh-all") {
    if (!file) throw new Error("No note file for dashboard refresh.");
    await plugin.actions.refreshAllDashboardWidgets(file);
    await plugin.projects.refreshProjectHeaderOnDailyNote();
    new Notice("Dashboard widgets refreshed");
    return;
  }
  if (action === "weather-click") {
    if (target.closest("[data-loading='true'], .dashboard-weather-bar--loading")) {
      if (!file) throw new Error("No note file for widget refresh.");
      await plugin.actions.refreshWidget(file, "weather");
      return;
    }
    await plugin.actions.handleWeatherClick();
    return;
  }
  if (action === "hevy-create") {
    if (!file) throw new Error("No note file for Hevy action.");
    await plugin.actions.handleHevyCreate(file, target.dataset.date ?? file.basename);
    return;
  }
  if (action === "weight-click") {
    if (!file) throw new Error("No note file for weight action.");
    await plugin.actions.handleWeightClick(file);
    return;
  }
  if (action === "habit-log") {
    if (!file) throw new Error("No note file for habit log.");
    const habitPath = target.dataset.path;
    if (!habitPath) return;
    const root = target.closest<HTMLElement>(".dashboard-habits");
    const contextDate = /^\d{4}-\d{2}-\d{2}$/.test(file.basename)
      ? file.basename
      : (root?.dataset.contextDate ?? file.basename);
    await plugin.actions.handleHabitLog(file, habitPath, target.dataset.frequency ?? "1", contextDate);
    return;
  }
  if (action === "habit-open") {
    if (!file) throw new Error("No note file for habits index.");
    await plugin.actions.openHabitsIndex();
    return;
  }
  if (action === "project-create-open") {
    if (!plugin.projects) throw new Error("plugin.projects is missing");
    await plugin.projects.openCreateFromCalendarModal();
    debugProject(plugin.settings.debugProjectButton, "runDashboardAction → modal returned");
    return;
  }
  if (action === "gcal-auth-open") {
    await plugin.actions.handleGcalAuthOpen();
    return;
  }
  if (action === "gcal-event-open") {
    if (!file) throw new Error("No note file for calendar event.");
    await plugin.actions.handleGcalEventOpen(file, target);
    return;
  }
  if (action === "daily-diary-open") {
    const date = target.dataset.date?.trim() ?? resolveDailyDiaryNavDate(target);
    if (!date) throw new Error("No date for daily diary navigation.");
    await openDailyDiary(plugin.app, date, plugin.settings.dailyTemplatePath, dailyDiaryOptions(plugin));
    return;
  }
  if (action === "shopping-quick-add") {
    await plugin.actions.handleShoppingQuickAdd();
    return;
  }
  if (action === "gb-sync") {
    if (!file) throw new Error("No note file for GB Online sync.");
    await plugin.actions.handleGbSync(file, target);
    return;
  }
  if (action === "gb-open-video") {
    if (!file) throw new Error("No note file for GB Online.");
    const cid = target.dataset.cid?.trim() ?? "";
    const url = target.dataset.url?.trim() ?? "";
    await plugin.actions.handleGbOpenVideo(file, target, cid, url);
    return;
  }
  if (action === "gb-open-track") {
    if (!file) throw new Error("No note file for GB Online.");
    const track = target.dataset.track === "gb2" ? "gb2" : "gb1";
    await plugin.actions.handleGbOpenTrack(file, target, track);
    return;
  }
  if (action === "gb-open-week") {
    if (!file) throw new Error("No note file for GB Online.");
    await plugin.actions.handleGbOpenWeek(file, target);
    return;
  }
  if (action === "gb-toggle-watched") {
    if (!file) throw new Error("No note file for GB Online.");
    const cid = target.dataset.cid?.trim() ?? "";
    await plugin.actions.handleGbToggleWatched(file, target, cid);
    return;
  }
  if (action === "gb-daily-toggle-playlist") {
    if (!file) throw new Error("No note file for GB Online daily.");
    await plugin.actions.handleGbDailyTogglePlaylist(file, target);
    return;
  }
  if (action === "gb-daily-toggle-watched") {
    if (!file) throw new Error("No note file for GB Online daily.");
    const cid = target.dataset.cid?.trim() ?? "";
    await plugin.actions.handleGbDailyToggleWatched(file, target, cid);
    return;
  }
  if (action === "gb-daily-toggle-series-watched") {
    if (!file) throw new Error("No note file for GB Online daily.");
    const seriesId = target.dataset.seriesId?.trim() ?? "";
    await plugin.actions.handleGbDailyToggleSeriesWatched(file, target, seriesId);
    return;
  }
  if (action === "gb-daily-queue-toggle") {
    if (!file) throw new Error("No note file for GB Online daily.");
    const cid = target.dataset.cid?.trim() ?? "";
    const seriesId = target.dataset.seriesId?.trim() ?? "";
    await plugin.actions.handleGbDailyQueueToggle(file, target, cid, seriesId);
    return;
  }
  if (action === "gb-clear-sync") {
    if (!file) throw new Error("No note file for GB Online daily.");
    await plugin.actions.handleGbClearSync(file, target);
    return;
  }
}

async function handleDashboardClick(
  plugin: LifeAdminPluginLike,
  evt: Event,
  el: HTMLElement,
  sourcePath?: string,
  via: "post-processor" | "dom" = "dom",
): Promise<void> {
  const isProject = isProjectDebugTarget(el);
  if (isProject) {
    debugProject(plugin.settings.debugProjectButton, `click via ${via}`, describeElement(el));
  }

  if ((evt as Event & { [HANDLED]?: boolean })[HANDLED]) {
    if (isProject) debugProject(plugin.settings.debugProjectButton, "skipped: already handled");
    return;
  }
  (evt as Event & { [HANDLED]?: boolean })[HANDLED] = true;

  const action = resolveAction(el);
  if (isProject) {
    debugProject(plugin.settings.debugProjectButton, "resolved action", { action, sourcePath: sourcePath ?? null });
  }
  if (!action) {
    if (isProject) debugProject(plugin.settings.debugProjectButton, "stopped: no action resolved");
    return;
  }

  const file = actionNeedsFile(action) ? fileFromClick(plugin.app, el, sourcePath) : null;
  if (isProject) {
    debugProject(plugin.settings.debugProjectButton, "resolved file", { file: file?.path ?? null, needsFile: actionNeedsFile(action) });
  }
  if (actionNeedsFile(action) && !file) {
    if (isProject) debugProject(plugin.settings.debugProjectButton, "stopped: file required but missing");
    return;
  }

  if (action === "gb-open-video") {
    const cid = el.dataset.cid?.trim() ?? "";
    const url = el.getAttribute("href")?.trim() ?? el.dataset.url?.trim() ?? "";
    void plugin.actions.handleGbOpenVideo(file!, el, cid, url).catch((e) => {
      new Notice(`GB Online: ${e instanceof Error ? e.message : String(e)}`);
    });
    return;
  }

  if (action === "gb-daily-featured") {
    evt.preventDefault();
    const cid = el.dataset.cid?.trim() ?? "";
    const url = el.dataset.url?.trim() ?? "";
    void plugin.actions.handleGbDailyFeatured(file!, el, cid, url).catch((e) => {
      new Notice(`GB Online: ${e instanceof Error ? e.message : String(e)}`);
    });
    return;
  }

  evt.preventDefault();
  evt.stopPropagation();
  (evt as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();

  const button = el instanceof HTMLButtonElement ? el : el.querySelector("button");
  if (button) button.disabled = true;

  try {
    if (isProject) debugProject(plugin.settings.debugProjectButton, "calling runDashboardAction");
    await runDashboardAction(plugin, action, el, file);
    if (isProject) debugProject(plugin.settings.debugProjectButton, "runDashboardAction finished OK");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isProject) debugProject(plugin.settings.debugProjectButton, "runDashboardAction ERROR", { msg });
    new Notice(`Dashboard action failed: ${msg}`);
  } finally {
    if (button) button.disabled = false;
  }
}

function bindDashboardActivation(
  plugin: LifeAdminPluginLike,
  el: HTMLElement,
  sourcePath: string | undefined,
  via: "post-processor" | "dom",
): void {
  prepareActionElement(el);
  const run = (evt: Event) => {
    if (!shouldActivate(el, evt)) return;
    void handleDashboardClick(plugin, evt, el, sourcePath, via);
  };
  el.addEventListener("click", run);
}

function handleDocumentPointerDown(evt: Event): void {
  recordTapStart(evt);
}

function handleDocumentActivation(plugin: LifeAdminPluginLike, evt: Event): void {
  const target = evt.target as HTMLElement;
  if (plugin.settings.debugProjectButton && target.closest?.(".dashboard-project-add, [data-action='project-create-open']")) {
    debugProject(plugin.settings.debugProjectButton, `raw document ${evt.type} on project UI`, {
      targetTag: target.tagName,
      targetClass: target.className,
      inDashboardTarget: isDashboardClickTarget(target),
    });
  }

  const diaryDate = resolveDailyDiaryNavDate(target);
  if (diaryDate && isDashboardClickTarget(target)) {
    const link = target.closest<HTMLElement>(".dashboard-gcal-nav-btn[data-date]");
    if (link && shouldActivate(link, evt)) {
      evt.preventDefault();
      evt.stopPropagation();
      (evt as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
      void openDailyDiary(plugin.app, diaryDate, plugin.settings.dailyTemplatePath, dailyDiaryOptions(plugin)).catch((e) => {
        new Notice(`Daily note failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      return;
    }
  }

  const el = target.closest<HTMLElement>("[data-action], .dashboard-project-add");
  if (!el) return;

  if (isProjectDebugTarget(el) && !isDashboardClickTarget(el)) {
    debugProject(plugin.settings.debugProjectButton, `dom ${evt.type} stopped: not in dashboard view container`, {
      ...describeElement(el),
    });
    return;
  }
  if (!isDashboardClickTarget(el)) return;
  if (!shouldActivate(el, evt)) return;

  const sourcePath = el.closest(".markdown-preview-section")?.getAttribute("data-path") ?? undefined;
  void handleDashboardClick(plugin, evt, el, sourcePath, "dom");
}

function bindGbDailyDrag(plugin: LifeAdminPluginLike, root: HTMLElement, sourcePath: string): void {
  if (root.dataset.gbDailyDragBound === "1") return;
  root.dataset.gbDailyDragBound = "1";

  let dragPayload: { type: "series" | "video"; seriesId: string; cid?: string } | null = null;

  root.addEventListener("dragstart", (evt) => {
    const grip = (evt.target as HTMLElement).closest<HTMLElement>("[data-gb-daily-drag]");
    if (!grip || !root.contains(grip)) return;
    const seriesRow = grip.closest<HTMLElement>(".dashboard-gb-daily-series");
    if (seriesRow?.classList.contains("is-pinned") && grip.dataset.gbDailyDrag === "series") return;
    const type = grip.dataset.gbDailyDrag === "video" ? "video" : "series";
    dragPayload = {
      type,
      seriesId: grip.dataset.seriesId?.trim() ?? "",
      cid: grip.dataset.cid?.trim(),
    };
    evt.dataTransfer?.setData("text/plain", type);
    evt.dataTransfer!.effectAllowed = "move";
  });

  root.addEventListener("dragover", (evt) => {
    if (!dragPayload) return;
    const over = (evt.target as HTMLElement).closest<HTMLElement>(
      dragPayload.type === "series" ? ".dashboard-gb-daily-series" : ".dashboard-gb-daily-video",
    );
    if (!over || !root.contains(over)) return;
    evt.preventDefault();
    evt.dataTransfer!.dropEffect = "move";
  });

  root.addEventListener("drop", (evt) => {
    if (!dragPayload) return;
    const file = fileFromClick(plugin.app, root, sourcePath);
    if (!(file instanceof TFile)) return;

    if (dragPayload.type === "series") {
      const over = (evt.target as HTMLElement).closest<HTMLElement>(".dashboard-gb-daily-series");
      if (!over) return;
      const fromSeriesId = dragPayload.seriesId;
      const toSeriesId = over.dataset.seriesId?.trim() ?? "";
      if (!fromSeriesId || !toSeriesId || fromSeriesId === toSeriesId) return;
      evt.preventDefault();
      void plugin.actions.handleGbDailyReorderSeries(file, root, fromSeriesId, toSeriesId);
    } else {
      const over = (evt.target as HTMLElement).closest<HTMLElement>(".dashboard-gb-daily-video");
      if (!over) return;
      const seriesId = dragPayload.seriesId;
      const fromCid = dragPayload.cid?.trim() ?? "";
      const toCid = over.dataset.cid?.trim() ?? "";
      if (!seriesId || !fromCid || !toCid || fromCid === toCid) return;
      evt.preventDefault();
      void plugin.actions.handleGbDailyReorderVideo(file, root, seriesId, fromCid, toCid);
    }
    dragPayload = null;
  });

  root.addEventListener("dragend", () => {
    dragPayload = null;
  });
}

function hydrateGbDailyLogo(plugin: LifeAdminPluginLike, root: HTMLElement): void {
  const img = root.querySelector<HTMLImageElement>(".dashboard-gb-daily-section-logo");
  if (!img) return;
  const pluginDir = (plugin as Plugin).manifest?.dir ?? "";
  img.src = resolveGbLogoUrl(plugin.app, plugin.settings, pluginDir);
}

function bindGbDailyWidgetDetails(plugin: LifeAdminPluginLike, root: HTMLElement, sourcePath: string): void {
  hydrateGbDailyLogo(plugin, root);
  if (!root.classList.contains("dashboard-gb-daily-widget")) return;

  restoreGbDailyWidgetExpandedFromSession(root, sourcePath);

  if (root.dataset.gbDailyWidgetBound === "1") return;
  root.dataset.gbDailyWidgetBound = "1";

  if (root instanceof HTMLDetailsElement) {
    root.addEventListener("toggle", (evt) => {
      if (evt.target !== root) return;
      const file = fileFromClick(plugin.app, root, sourcePath);
      if (!(file instanceof TFile)) return;
      const weekNum = Number(root.dataset.week ?? NaN);
      if (isDailyNotePath(file.path)) {
        setSessionDailyWidgetExpanded(file.path, root.open);
        return;
      }
      if (Number.isFinite(weekNum) && weekNum > 0) {
        void setDailyWidgetExpanded(plugin.app, plugin.settings, weekNum, root.open);
      }
    });
    return;
  }

  // Legacy div-based shell from an intermediate build
  const header = root.querySelector<HTMLElement>(".dashboard-gb-daily-section-header");
  if (!header) return;
  header.addEventListener("click", (evt) => {
    if ((evt.target as HTMLElement).closest("[data-action]")) return;
    const file = fileFromClick(plugin.app, root, sourcePath);
    const expanded = !root.classList.contains("is-expanded");
    applyGbDailyWidgetExpanded(root, expanded);
    if (!(file instanceof TFile)) return;
    if (isDailyNotePath(file.path)) {
      setSessionDailyWidgetExpanded(file.path, expanded);
    }
  });
}

function bindGbDailySeriesDetails(plugin: LifeAdminPluginLike, root: HTMLElement, sourcePath: string): void {
  if (root.dataset.gbDailyDetailsBound === "1") return;
  root.dataset.gbDailyDetailsBound = "1";
  const weekNum = Number(root.dataset.week ?? NaN);
  if (!Number.isFinite(weekNum) || weekNum <= 0) return;

  root.addEventListener(
    "toggle",
    (evt) => {
      const details = (evt.target as HTMLElement).closest<HTMLDetailsElement>(".dashboard-gb-daily-series-details");
      if (!details || !root.contains(details)) return;
      const file = fileFromClick(plugin.app, root, sourcePath);
      if (!(file instanceof TFile)) return;
      const openIds = Array.from(root.querySelectorAll<HTMLDetailsElement>(".dashboard-gb-daily-series-details[open]"))
        .map((el) => el.closest<HTMLElement>(".dashboard-gb-daily-series")?.dataset.seriesId?.trim() ?? "")
        .filter(Boolean);
      void setDailyOpenSeries(plugin.app, plugin.settings, weekNum, openIds);
    },
    true,
  );

  root.addEventListener(
    "click",
    (evt) => {
      const target = evt.target as HTMLElement;
      const actionEl = target.closest<HTMLElement>("[data-action]");
      if (actionEl?.classList.contains("dashboard-gb-daily-series-toggle")) {
        evt.preventDefault();
      }
      if (actionEl?.closest(".dashboard-gb-daily-series-videos")) {
        evt.stopPropagation();
      }
    },
    true,
  );
}

function gbDailyBindRoots(container: HTMLElement): HTMLElement[] {
  const roots = Array.from(container.querySelectorAll<HTMLElement>(".dashboard-gb-daily"));
  if (container.classList.contains("dashboard-gb-daily") && !roots.includes(container)) {
    roots.unshift(container);
  }
  return roots;
}

function bindRefreshCallout(plugin: LifeAdminPluginLike, root: HTMLElement, sourcePath: string): void {
  root.querySelectorAll<HTMLElement>(".callout[data-callout='refresh'] .callout-title").forEach((titleEl) => {
    if (titleEl.dataset.dashboardBound === "1") return;
    titleEl.dataset.dashboardBound = "1";
    titleEl.dataset.action = "dashboard-refresh-all";
    titleEl.classList.add("dashboard-refresh-callout-title");
    bindDashboardActivation(plugin, titleEl, sourcePath, "post-processor");
  });
}

function bindActionElements(plugin: LifeAdminPluginLike, root: HTMLElement, sourcePath: string): void {
  bindRefreshCallout(plugin, root, sourcePath);
  const actionEls = root.querySelectorAll<HTMLElement>("[data-action], .dashboard-project-add");
  let bound = 0;
  for (const actionEl of actionEls) {
    const isProject = isProjectDebugTarget(actionEl);
    if (actionEl.dataset.dashboardBound === "1") {
      if (isProject) {
        debugProject(plugin.settings.debugProjectButton, "post-processor: already bound", { sourcePath });
      }
      continue;
    }
    actionEl.dataset.dashboardBound = "1";
    if (isProject) {
      actionEl.dataset.lifeadminDebug = "bound";
      debugProject(plugin.settings.debugProjectButton, "post-processor: bound activation handler", {
        sourcePath,
        ...describeElement(actionEl),
      });
    }
    bindDashboardActivation(plugin, actionEl, sourcePath, "post-processor");
    bound++;
  }
  for (const dailyRoot of gbDailyBindRoots(root)) {
    bindGbDailyWidgetDetails(plugin, dailyRoot, sourcePath);
    bindGbDailyDrag(plugin, dailyRoot, sourcePath);
    bindGbDailySeriesDetails(plugin, dailyRoot, sourcePath);
  }
  if (plugin.settings.debugProjectButton && actionEls.length > 0) {
    console.log(`[LifeAdmin] post-processor scanned ${sourcePath}: ${actionEls.length} action el(s), bound ${bound}`);
  }
}

export function rebindDashboardWidgets(plugin: LifeAdminPluginLike, root: HTMLElement, sourcePath: string): void {
  bindActionElements(plugin, root, sourcePath);
}

function auditProjectButtons(plugin: LifeAdminPluginLike): void {
  if (!plugin.settings.debugProjectButton) return;
  const buttons = document.querySelectorAll<HTMLElement>(".dashboard-project-add, [data-action='project-create-open']");
  debugProject(plugin.settings.debugProjectButton, "DOM audit on layout ready", {
    count: buttons.length,
    samples: Array.from(buttons)
      .slice(0, 3)
      .map((el) => describeElement(el)),
  });
}

export function registerDashboardPostProcessor(plugin: LifeAdminPluginLike): void {
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    if (isDailyNotePath(ctx.sourcePath)) {
      scheduleWeeklyDayEmbedPass(el);
    }
  });

  plugin.registerMarkdownPostProcessor((el) => {
    if (el.querySelector(".callout[data-callout='shopping']")) {
      void syncShoppingCalloutVisibility(plugin.app, plugin.settings.shoppingListPath);
    }
  });

  plugin.registerMarkdownPostProcessor((el, ctx) => {
    const hasActions = el.querySelector(".dashboard-widget, [data-action], .dashboard-project-add");
    if (!hasActions) return;
    if (el.querySelector(".dashboard-project-add, [data-action='project-create-open']")) {
      debugProject(plugin.settings.debugProjectButton, "post-processor: section has project button", {
        sourcePath: ctx.sourcePath,
      });
    }
    bindActionElements(plugin, el, ctx.sourcePath);
    if (isDailyNotePath(ctx.sourcePath) && el.querySelector(".dashboard-gb-daily-widget")) {
      const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (file instanceof TFile) {
        void plugin.actions.migrateGbDailyDivWidgetIfNeeded(file);
        void plugin.actions.repairGbDailyFromStoreIfNeeded(file);
      }
    }
  });

  plugin.registerDomEvent(document, "click", (evt) => handleDocumentActivation(plugin, evt), { capture: true });
  plugin.registerDomEvent(document, "pointerup", (evt) => handleDocumentActivation(plugin, evt), { capture: true });
  plugin.registerDomEvent(document, "pointerdown", (evt) => handleDocumentPointerDown(evt), { capture: true });

  plugin.registerDomEvent(
    document,
    "pointerdown",
    (evt) => {
      const target = evt.target as HTMLElement;
      if (!plugin.settings.debugProjectButton) return;
      if (!target.closest?.(".dashboard-project-add, [data-action='project-create-open']")) return;
      debugProject(plugin.settings.debugProjectButton, "pointerdown on project button", {
        targetTag: target.tagName,
      });
    },
    { capture: true },
  );

  plugin.app.workspace.onLayoutReady(() => {
    auditProjectButtons(plugin);
  });
}
