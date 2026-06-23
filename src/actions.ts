import { App, Modal, Notice, TFile } from "obsidian";
import type { DashboardBaker } from "./bake";
import { openGoogleCalendarAuthSettings, openGoogleCalendarEventEditor } from "./gcal-events";
import { parseHevyWorkoutsFromMarkdown } from "./hevy-log";
import { frontmatterFromMarkdown, habitMetaFromFrontmatter, hideHabitForDate, saveHabitLog } from "./habits";
import type { LifeAdminSettings } from "./settings";
import { hasWidgetMarkers, extractWidgetInnerFromFile, replaceWidgetInFile, stripLegacyGcalNavLine, enqueueVaultFileMutation } from "./widget-markers";
import type { WidgetName } from "./utils";
import { DAILY_NOTE_PATH_RE } from "./daily-notes";
import {
  focusShoppingListTaskLine,
  insertShoppingListTaskAndGetLine,
  resolveShoppingListFile,
  syncShoppingCalloutVisibility,
} from "./shopping-list";
import { WeighInModal } from "./weigh-in-modal";
import { appendWeightEntry, parseWeightEntries } from "./weight-data";
import {
  computeTrackProgress,
  readGbOnlineData,
  referenceDateForNote,
  resolveGbWeekContext,
  setVideoRevealed,
  setVideoWatched,
  syncGbWeekCatalog,
  clearGbWeekSync,
  type GbTrack,
} from "./gb-online-data";
import {
  markDailyVideoWatched,
  mergeDailyLayoutOnSync,
  computeDailyProgress,
  gbDailyBakeSnapshotFromProgress,
  isGbDailyBakedHtmlStale,
  readDailyPlaylistOpen,
  readDailyOpenSeriesFromDom,
  captureGbDailyExpandedSession,
  readSessionDailyWidgetExpanded,
  reorderDailySeriesById,
  reorderDailyVideo,
  reorderDailyVideoByCid,
  setDailyOpenSeries,
  setDailyPlaylistOpen,
  toggleDailyQueueVideo,
  toggleDailySeriesWatched,
  toggleDailyVideoWatched,
} from "./gb-online-daily";
import {
  clearGbDailyVaultPending,
  findGbDailyWidgetRoots,
  flushGbDailyVaultWrite,
  patchGbDailyPlaylistOpen,
  persistGbDailyHtmlToVault,
  queueGbDailyVaultWrite,
  replaceGbDailyWidgetInViews,
} from "./gb-online-daily-view";

const gbDailyDivMigratePaths = new Set<string>();
const gbDailyUnsyncRepairPaths = new Set<string>();

const HEVY_BASE = "https://api.hevyapp.com/v1";

function notify(msg: string): void {
  new Notice(String(msg));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function firstEmoji(name: string): string {
  const chars = Array.from(String(name ?? "").trim());
  return chars[0] ?? "🏋️";
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const out = new Date(dt.getTime() + days * 86400000);
  return `${out.getUTCFullYear()}-${pad2(out.getUTCMonth() + 1)}-${pad2(out.getUTCDate())}`;
}

function extractInnerWidgetHtml(wrapped: string): string {
  const lines = wrapped.replace(/\r\n/g, "\n").split("\n");
  return lines.length > 2 ? lines.slice(1, -1).join("\n") : wrapped;
}

function isGbDailyUnsyncedHtml(html: string): boolean {
  return html.includes("dashboard-gb-daily-sync-prompt");
}

function setWeightLoggedTrue(fileText: string): string {
  const text = String(fileText ?? "").replace(/\r\n/g, "\n");
  const marker = "---\n";
  if (text.startsWith(marker)) {
    const parts = text.split(marker);
    if (parts.length >= 3) {
      let yaml = parts[1] ?? "";
      const rest = parts.slice(2).join(marker);
      if (/^Weight_Logged\s*:/m.test(yaml)) yaml = yaml.replace(/^Weight_Logged\s*:\s*.*$/m, "Weight_Logged: true");
      else yaml = `${yaml}${yaml.endsWith("\n") || !yaml ? "" : "\n"}Weight_Logged: true\n`;
      return marker + yaml + marker + rest;
    }
  }
  return `---\nWeight_Logged: true\n---\n${text}`;
}

class HabitEntryModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly onSave: (entered: string) => Promise<void>,
    private readonly onHideForToday: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("lifeadmin-habit-modal");
    modalEl.addClass("lifeadmin-habit-modal-container");
    this.titleEl.setText(`Log: ${this.titleText}`);

    const input = contentEl.createEl("input", {
      type: "text",
      cls: "lifeadmin-habit-modal-input mod-input",
      attr: { placeholder: "e.g. 80 (or leave blank)" },
    });
    input.addEventListener("input", () => {
      this.value = input.value;
    });
    setTimeout(() => input.focus(), 0);

    const actions = contentEl.createDiv({ cls: "lifeadmin-habit-modal-actions" });
    actions
      .createEl("button", { text: "Save", cls: "mod-cta" })
      .addEventListener("click", async () => {
        await this.onSave(String(this.value ?? "").trimEnd());
        this.close();
      });
    actions.createEl("button", { text: "Postpone" }).addEventListener("click", async () => {
      await this.onHideForToday();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface DashboardViewHelpers {
  rebindGbDaily?: (file: TFile, root: HTMLElement) => void;
}

export interface RefreshWidgetOptions {
  /** Force vault + view sync instead of in-place DOM update (daily GB widget). */
  forceVaultSync?: boolean;
}

export class DashboardActions {
  private viewHelpers: DashboardViewHelpers = {};
  private hevySyncPromise: Promise<number> | null = null;

  constructor(
    private readonly app: App,
    private readonly settings: LifeAdminSettings,
    private readonly baker: DashboardBaker,
  ) {}

  setViewHelpers(helpers: DashboardViewHelpers): void {
    this.viewHelpers = helpers;
  }

  private async persistGbDailyVault(file: TFile, innerHtml: string): Promise<void> {
    await persistGbDailyHtmlToVault(this.app, file, innerHtml);
  }

  private async queueGbDailyVaultBake(file: TFile): Promise<void> {
    const innerHtml = await this.resolveGbDailyInnerHtml(file);
    if (!innerHtml) return;
    await this.persistGbDailyVault(file, innerHtml);
  }

  private async bakeGbDailyInnerHtml(file: TFile): Promise<string> {
    const wrapped = await this.baker.bakeGbOnlineDaily({ noteDate: file.basename, file });
    return extractInnerWidgetHtml(wrapped);
  }

  private async resolveGbDailyInnerHtml(file: TFile): Promise<string | null> {
    let innerHtml = await this.bakeGbDailyInnerHtml(file);
    if (!isGbDailyUnsyncedHtml(innerHtml)) return innerHtml;

    const referenceDate = referenceDateForNote(this.app, file);
    const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
    if (!weekContext) return null;

    const store = await readGbOnlineData(this.app, this.settings.gbOnlineDataPath);
    const cachedVideos = store.weeks[String(weekContext.weekNum)]?.videos ?? [];
    if (!cachedVideos.length) return null;

    console.warn("LifeAdmin: GB daily bake returned unsynced despite cached week; retrying");
    innerHtml = await this.bakeGbDailyInnerHtml(file);
    return isGbDailyUnsyncedHtml(innerHtml) ? null : innerHtml;
  }

  private async refreshGbDailyInPlace(
    file: TFile,
    target?: HTMLElement,
    opts?: { skipPersistUi?: boolean; flushVault?: boolean },
  ): Promise<void> {
    if (target) captureGbDailyExpandedSession(file, target);
    if (!opts?.skipPersistUi) await this.persistDailyUiFromDom(file);
    const innerHtml = await this.resolveGbDailyInnerHtml(file);
    if (!innerHtml) {
      console.warn("LifeAdmin: GB daily refresh skipped — would have shown unsynced state");
      return;
    }
    const expanded = readSessionDailyWidgetExpanded(file.path) === true;
    const replaced = replaceGbDailyWidgetInViews(this.app, file, innerHtml, expanded);
    if (replaced.length) {
      if (opts?.flushVault !== false) {
        await this.persistGbDailyVault(file, innerHtml);
      }
      for (const root of replaced) {
        const section = root.closest(".markdown-preview-section") ?? root.parentElement ?? root;
        this.viewHelpers.rebindGbDaily?.(file, section);
      }
      return;
    }
    if (opts?.flushVault !== false) {
      await this.queueGbDailyVaultBake(file);
    }
  }

  private async readBakedGbDailyHtml(file: TFile): Promise<string | null> {
    const roots = findGbDailyWidgetRoots(this.app, file);
    if (roots[0]) return roots[0].outerHTML;
    const raw = await this.app.vault.read(file);
    return extractWidgetInnerFromFile(raw, "gb-online-daily");
  }

  private async isGbDailyHtmlStaleForFile(file: TFile): Promise<boolean> {
    const referenceDate = referenceDateForNote(this.app, file);
    const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
    if (!weekContext) return false;

    const store = await readGbOnlineData(this.app, this.settings.gbOnlineDataPath);
    const videos = store.weeks[String(weekContext.weekNum)]?.videos ?? [];
    if (!videos.length) return false;

    const layout = store.dailyLayouts?.[String(weekContext.weekNum)];
    if (!layout?.series?.length) return false;

    const progress = computeDailyProgress(videos, layout, store.watched);
    const expected = gbDailyBakeSnapshotFromProgress(progress, true);
    const html = await this.readBakedGbDailyHtml(file);
    if (!html) return true;
    return isGbDailyBakedHtmlStale(html, expected);
  }

  async repairGbDailyFromStoreIfNeeded(file: TFile): Promise<void> {
    if (!DAILY_NOTE_PATH_RE.test(file.path)) return;
    if (gbDailyUnsyncRepairPaths.has(file.path)) return;

    const raw = await this.app.vault.read(file);
    if (!hasWidgetMarkers(raw, "gb-online-daily")) return;

    const baked = extractWidgetInnerFromFile(raw, "gb-online-daily") ?? "";
    const unsyncPrompt = baked.includes("dashboard-gb-daily-sync-prompt");
    const stale = unsyncPrompt || (await this.isGbDailyHtmlStaleForFile(file));
    if (!stale) return;

    const referenceDate = referenceDateForNote(this.app, file);
    const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
    if (!weekContext) return;
    const store = await readGbOnlineData(this.app, this.settings.gbOnlineDataPath);
    const videos = store.weeks[String(weekContext.weekNum)]?.videos ?? [];
    if (!videos.length) return;

    gbDailyUnsyncRepairPaths.add(file.path);
    try {
      await this.refreshGbDailyInPlace(file, undefined, { skipPersistUi: true, flushVault: true });
    } finally {
      gbDailyUnsyncRepairPaths.delete(file.path);
    }
  }

  /** @deprecated Use repairGbDailyFromStoreIfNeeded */
  async repairGbDailyBakedUnsyncIfNeeded(file: TFile): Promise<void> {
    await this.repairGbDailyFromStoreIfNeeded(file);
  }

  async migrateGbDailyDivWidgetIfNeeded(file: TFile): Promise<void> {
    if (!DAILY_NOTE_PATH_RE.test(file.path)) return;
    if (gbDailyDivMigratePaths.has(file.path)) return;
    const hasDivShell = findGbDailyWidgetRoots(this.app, file).some((root) => root.tagName === "DIV");
    if (!hasDivShell) return;
    gbDailyDivMigratePaths.add(file.path);
    try {
      await this.refreshGbDailyInPlace(file);
    } finally {
      gbDailyDivMigratePaths.delete(file.path);
    }
  }

  async refreshWidget(file: TFile, widget: WidgetName, opts?: RefreshWidgetOptions): Promise<void> {
    if (widget === "gb-online-daily" && DAILY_NOTE_PATH_RE.test(file.path) && !opts?.forceVaultSync) {
      await this.refreshGbDailyInPlace(file);
      return;
    }

    if (widget === "gb-online-daily") {
      await this.persistDailyUiFromDom(file);
    }
    const ctx = { noteDate: file.basename, file };
    const wrapped =
      widget === "weather"
        ? await this.baker.bakeWeather(ctx)
        : widget === "hevy"
          ? await this.baker.bakeHevy(ctx)
          : widget === "weight"
            ? await this.baker.bakeWeight(ctx)
            : widget === "habits"
              ? await this.baker.bakeHabits(ctx)
              : widget === "gb-online-prototype"
                ? await this.baker.bakeGbOnlinePrototype(ctx)
                : widget === "gb-online-daily"
                  ? await this.baker.bakeGbOnlineDaily(ctx)
                  : await this.baker.bakeGcal(ctx);
    if (widget === "gcal") {
      await enqueueVaultFileMutation(file.path, async () => {
        const raw = await this.app.vault.read(file);
        const stripped = stripLegacyGcalNavLine(raw);
        if (stripped !== raw) await this.app.vault.modify(file, stripped);
      });
    }

    const innerHtml = extractInnerWidgetHtml(wrapped);
    if (widget === "gb-online-daily" && DAILY_NOTE_PATH_RE.test(file.path)) {
      clearGbDailyVaultPending(file.path);
    }
    await replaceWidgetInFile(this.app, file, widget, innerHtml);
    this.app.plugins.plugins?.dataview?.api?.refresh?.();
  }

  async refreshAllDashboardWidgets(file: TFile): Promise<void> {
    await Promise.all(
      (["weather", "hevy", "weight", "habits", "gcal", "gb-online-daily"] as const).map((widget) =>
        this.refreshWidget(
          file,
          widget,
          widget === "gb-online-daily" ? { forceVaultSync: true } : undefined,
        ).catch((e) => {
          console.warn(`LifeAdmin: ${widget} refresh failed:`, e);
        }),
      ),
    );
    this.app.plugins.plugins?.dataview?.api?.refresh?.();
  }

  async handleWeatherClick(): Promise<void> {
    const name = this.settings.weatherShortcut.trim() || "Weather";
    window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
  }

  async handleHevyCreate(file: TFile, dateYmd: string): Promise<void> {
    if (!this.settings.hevyApiKey.trim()) {
      notify("Set Hevy API key in plugin settings.");
      return;
    }

    this.syncHevyWorkoutsInBackground(file);

    const routines = this.sortRoutinesByRecentWorkouts(await this.listRoutines(100));
    if (!routines.length) throw new Error("No routines returned from Hevy.");

    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    const start = new Date(end.getTime() - 3600000);
    const defaults = {
      date: /^\d{4}-\d{2}-\d{2}$/.test(dateYmd)
        ? dateYmd
        : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
      start: `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
      end: `${pad2(end.getHours())}:${pad2(end.getMinutes())}`,
    };

    const recentWorkouts = await this.getRecentWorkoutNames(5);
    const dialog = await this.buildRoutineDialog(routines, defaults, recentWorkouts);
    if (!dialog) return;
    const { routineId, date, start: startStr, end: endStr, close } = dialog;
    if (!routineId) {
      notify("Pick a routine from the list.");
      return;
    }
    const startDt = this.makeLocalDateTime(date, startStr);
    const endDt = this.makeLocalDateTime(date, endStr);
    if (endDt.getTime() <= startDt.getTime()) {
      notify("End time must be after start time.");
      return;
    }

    const detail = await this.hevyFetch(`/routines/${routineId}`);
    const routine = (detail?.routine ?? detail) as Record<string, any>;
    const payload = {
      workout: {
        title: String(routine?.title ?? "New Workout"),
        description: `From routine: ${routine?.title ?? routineId}`,
        start_time: startDt.toISOString(),
        end_time: endDt.toISOString(),
        is_private: false,
        exercises: this.sanitizeExercisesForPost(routine?.exercises),
      },
    };

    const created = await this.hevyFetch("/workouts", { method: "POST", body: payload });
    await this.upsertHevyLogFromCreatedWorkout(created, {
      fallbackTitle: payload.workout.title,
      fallbackStartIso: payload.workout.start_time,
    });
    await this.runHevySyncCoalesced();
    notify(`Hevy: Created workout "${payload.workout.title}"`);
    close();
    await this.refreshWidget(file, "hevy");
  }

  async handleWeightClick(file: TFile): Promise<void> {
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(file.basename)
      ? file.basename
      : window.moment().format("YYYY-MM-DD");

    let initialWeight = "";
    let initialBf = "";
    const weightFile = this.app.vault.getAbstractFileByPath(this.settings.weightDataPath);
    if (weightFile instanceof TFile) {
      const entries = parseWeightEntries(await this.app.vault.read(weightFile));
      const todays = entries.filter((e) => e.dateStr === dateStr);
      const ref = todays.length ? todays[todays.length - 1]! : entries[entries.length - 1];
      if (ref) {
        initialWeight = String(ref.weight);
        initialBf = String(ref.bf);
      }
    }

    const markLoggedAndRefresh = async (): Promise<void> => {
      const current = await this.app.vault.read(file);
      const updated = setWeightLoggedTrue(current);
      if (updated !== current.replace(/\r\n/g, "\n")) {
        await this.app.vault.modify(file, updated);
      }
      await this.refreshWidget(file, "weight");
    };

    new WeighInModal(
      this.app,
      dateStr,
      initialWeight,
      initialBf,
      async (weight, bf) => {
        try {
          await appendWeightEntry(this.app, this.settings.weightDataPath, {
            dateStr,
            weight,
            bf,
            source: "Manual",
          });
          await markLoggedAndRefresh();
          notify(`Weight saved: ${weight} kg, ${bf}%`);
        } catch (e) {
          notify(`Weight save failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      () => {
        void markLoggedAndRefresh();
        window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(this.settings.weighInShortcut)}`;
      },
    ).open();
  }

  async handleHabitLog(file: TFile, habitPath: string, _frequency: string, contextDate: string): Promise<void> {
    const habitFile = this.app.vault.getAbstractFileByPath(habitPath);
    if (!(habitFile instanceof TFile)) {
      notify(`Habit file missing: ${habitPath}`);
      return;
    }

    const save = async (entered: string): Promise<void> => {
      try {
        const nextDate = await saveHabitLog(this.app, habitFile, contextDate, entered);
        notify(`Saved & scheduled next: ${nextDate}`);
        await this.refreshWidget(file, "habits");
      } catch (e) {
        notify(`Habit save failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const current = await this.app.vault.read(habitFile);
    const meta = habitMetaFromFrontmatter(frontmatterFromMarkdown(current));
    if (!meta.modal) {
      await save("");
      return;
    }

    new HabitEntryModal(
      this.app,
      habitFile.basename,
      save,
      async () => {
        try {
          await hideHabitForDate(this.app, habitFile, contextDate);
          notify("Hidden for today");
          await this.refreshWidget(file, "habits");
        } catch (e) {
          notify(`Habit postpone failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    ).open();
  }

  async openHabitsIndex(): Promise<void> {
    const target = this.app.vault.getAbstractFileByPath(this.settings.habitsIndexPath);
    if (target instanceof TFile) await this.app.workspace.getLeaf(true).openFile(target);
    else notify(`Could not find: ${this.settings.habitsIndexPath}`);
  }

  async handleShoppingQuickAdd(): Promise<void> {
    const file = resolveShoppingListFile(this.app, this.settings.shoppingListPath);
    if (!file) {
      notify(`Shopping list not found: ${this.settings.shoppingListPath}`);
      return;
    }

    try {
      const line = await insertShoppingListTaskAndGetLine(this.app, file);
      await syncShoppingCalloutVisibility(this.app, this.settings.shoppingListPath);
      await focusShoppingListTaskLine(this.app, file, line);
    } catch (e) {
      notify(`Shopping quick add failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private gbReferenceDate(file: TFile, target: HTMLElement): string {
    const root = target.closest<HTMLElement>(".dashboard-gb-online, .dashboard-gb-daily, .dashboard-gb-prototype");
    const fromWidget = root?.dataset.contextDate?.trim();
    if (fromWidget && /^\d{4}-\d{2}-\d{2}$/.test(fromWidget)) return fromWidget;
    const fromTarget = target.dataset.date?.trim();
    if (fromTarget && /^\d{4}-\d{2}-\d{2}$/.test(fromTarget)) return fromTarget;
    return referenceDateForNote(this.app, file);
  }

  private gbWeekNum(target: HTMLElement): number | null {
    const root = target.closest<HTMLElement>(".dashboard-gb-online, .dashboard-gb-daily, .dashboard-gb-prototype");
    const week = Number(root?.dataset.week ?? NaN);
    return Number.isFinite(week) && week > 0 ? week : null;
  }

  async refreshGbOnlineWidgets(file: TFile, target?: HTMLElement): Promise<void> {
    if (target) captureGbDailyExpandedSession(file, target);
    const raw = await this.app.vault.read(file);
    if (hasWidgetMarkers(raw, "gb-online-daily")) {
      await this.refreshDailyWidget(file, false, target);
    }
    if (hasWidgetMarkers(raw, "gb-online-prototype")) {
      await this.refreshWidget(file, "gb-online-prototype");
    }
  }

  private async persistDailyUiFromDom(file: TFile): Promise<void> {
    const referenceDate = referenceDateForNote(this.app, file);
    const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
    if (!weekContext) return;
    const openIds = readDailyOpenSeriesFromDom(this.app, file, weekContext.weekNum);
    await setDailyOpenSeries(this.app, this.settings, weekContext.weekNum, openIds);
  }

  private async refreshDailyWidget(file: TFile, keepPlaylistOpen: boolean, target?: HTMLElement): Promise<void> {
    if (keepPlaylistOpen) {
      const referenceDate = referenceDateForNote(this.app, file);
      const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
      if (weekContext) {
        await setDailyPlaylistOpen(this.app, this.settings, weekContext.weekNum, true);
      }
    }
    await this.refreshGbDailyInPlace(file, target, { flushVault: true });
  }

  async handleGbSync(file: TFile, target: HTMLElement): Promise<void> {
    const referenceDate = this.gbReferenceDate(file, target);
    const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
    if (!weekContext) {
      notify("No GB Week URL found on this note or the current weekly note.");
      return;
    }
    notify(`Syncing Week ${weekContext.weekNum}…`);
    try {
      const cache = await syncGbWeekCatalog(this.app, this.settings, weekContext);
      await mergeDailyLayoutOnSync(this.app, this.settings, weekContext.weekNum, cache.videos);
      notify(`GB Online: synced ${cache.videos.length} videos for Week ${weekContext.weekNum} (watch progress unchanged)`);
      await this.refreshGbOnlineWidgets(file, target);
    } catch (e) {
      notify(`GB Online sync failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  async handleGbClearSync(file: TFile, target: HTMLElement): Promise<void> {
    const referenceDate = this.gbReferenceDate(file, target);
    const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
    if (!weekContext) {
      notify("No GB Week URL found on this note or the current weekly note.");
      return;
    }
    await clearGbWeekSync(this.app, this.settings, weekContext.weekNum);
    notify(`Cleared sync cache for Week ${weekContext.weekNum}`);
    await this.refreshGbOnlineWidgets(file, target);
  }

  async handleGbOpenVideo(file: TFile, target: HTMLElement, cid: string, url: string): Promise<void> {
    if (!cid || !url) return;
    const referenceDate = this.gbReferenceDate(file, target);
    await setVideoRevealed(this.app, this.settings, cid, referenceDate);
    await this.refreshWidget(file, "gb-online-prototype");
  }

  async handleGbDailyFeatured(file: TFile, target: HTMLElement, cid: string, url?: string): Promise<void> {
    if (!cid) return;
    captureGbDailyExpandedSession(file, target);
    const referenceDate = this.gbReferenceDate(file, target);
    const weekNum = this.gbWeekNum(target);
    const videoUrl = url?.trim() || target.dataset.url?.trim();
    await markDailyVideoWatched(this.app, this.settings, cid, referenceDate, weekNum ?? undefined);
    if (videoUrl) window.open(videoUrl, "_blank");
    await this.refreshGbDailyInPlace(file, target, { skipPersistUi: true, flushVault: true });
  }

  async handleGbDailyTogglePlaylist(file: TFile, target: HTMLElement): Promise<void> {
    captureGbDailyExpandedSession(file, target);
    const weekNum = this.gbWeekNum(target);
    if (weekNum === null) return;
    const store = await readGbOnlineData(this.app, this.settings.gbOnlineDataPath);
    const open = !readDailyPlaylistOpen(store, weekNum);
    await setDailyPlaylistOpen(this.app, this.settings, weekNum, open);

    const widget = target.closest<HTMLElement>(".dashboard-gb-daily-widget");
    if (widget && patchGbDailyPlaylistOpen(widget, open)) {
      await this.queueGbDailyVaultBake(file);
      return;
    }
    await this.refreshGbDailyInPlace(file, target, { flushVault: true });
  }

  async handleGbDailyToggleWatched(file: TFile, target: HTMLElement, cid: string): Promise<void> {
    if (!cid) return;
    captureGbDailyExpandedSession(file, target);
    const referenceDate = this.gbReferenceDate(file, target);
    const weekNum = this.gbWeekNum(target);
    await toggleDailyVideoWatched(this.app, this.settings, cid, referenceDate, weekNum ?? undefined);
    await this.refreshDailyWidget(file, true, target);
  }

  async handleGbDailyToggleSeriesWatched(file: TFile, target: HTMLElement, seriesId: string): Promise<void> {
    if (!seriesId) return;
    captureGbDailyExpandedSession(file, target);
    const weekNum = this.gbWeekNum(target);
    if (weekNum === null) return;
    const referenceDate = this.gbReferenceDate(file, target);
    await toggleDailySeriesWatched(this.app, this.settings, weekNum, seriesId, referenceDate);
    await this.refreshDailyWidget(file, true, target);
  }

  async handleGbDailyQueueToggle(file: TFile, target: HTMLElement, cid: string, seriesId: string): Promise<void> {
    if (!cid || !seriesId) return;
    captureGbDailyExpandedSession(file, target);
    const weekNum = this.gbWeekNum(target);
    if (weekNum === null) return;
    await toggleDailyQueueVideo(this.app, this.settings, weekNum, cid, seriesId);
    await this.refreshDailyWidget(file, true, target);
  }

  async handleGbDailyReorderSeries(
    file: TFile,
    target: HTMLElement,
    fromSeriesId: string,
    toSeriesId: string,
  ): Promise<void> {
    captureGbDailyExpandedSession(file, target);
    const weekNum = this.gbWeekNum(target);
    if (weekNum === null || !fromSeriesId || !toSeriesId) return;
    await reorderDailySeriesById(this.app, this.settings, weekNum, fromSeriesId, toSeriesId);
    await this.refreshDailyWidget(file, true, target);
  }

  async handleGbDailyReorderVideo(
    file: TFile,
    target: HTMLElement,
    seriesId: string,
    fromCid: string,
    toCid: string,
  ): Promise<void> {
    captureGbDailyExpandedSession(file, target);
    const weekNum = this.gbWeekNum(target);
    if (!seriesId || weekNum === null || !fromCid || !toCid) return;
    await reorderDailyVideoByCid(this.app, this.settings, weekNum, seriesId, fromCid, toCid);
    await this.refreshDailyWidget(file, true, target);
  }

  async handleGbOpenTrack(file: TFile, target: HTMLElement, track: GbTrack): Promise<void> {
    const referenceDate = this.gbReferenceDate(file, target);
    const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
    if (!weekContext) {
      notify("No GB week configured.");
      return;
    }
    const store = await readGbOnlineData(this.app, this.settings.gbOnlineDataPath);
    const cache = store.weeks[String(weekContext.weekNum)];
    if (!cache?.videos?.length) {
      notify("Sync curriculum first.");
      return;
    }
    const progress = computeTrackProgress(cache.videos, store.watched, track);
    if (!progress.nextVideo) {
      notify(`${progress.label}: all watched for this week.`);
      return;
    }
    await this.handleGbOpenVideo(file, target, progress.nextVideo.cid, progress.nextVideo.url);
  }

  async handleGbOpenWeek(file: TFile, target: HTMLElement): Promise<void> {
    const referenceDate = this.gbReferenceDate(file, target);
    const weekContext = await resolveGbWeekContext(this.app, this.settings, file, referenceDate);
    if (!weekContext?.weekUrl) {
      notify("No GB week URL found.");
      return;
    }
    window.open(weekContext.weekUrl, "_blank");
  }

  async handleGbToggleWatched(file: TFile, target: HTMLElement, cid: string): Promise<void> {
    if (!cid) return;
    const referenceDate = this.gbReferenceDate(file, target);
    const store = await readGbOnlineData(this.app, this.settings.gbOnlineDataPath);
    const watched = Boolean(store.watched[cid]);
    await setVideoWatched(this.app, this.settings, cid, !watched, referenceDate);
    await this.refreshGbOnlineWidgets(file);
  }

  async handleGcalAuthOpen(): Promise<void> {
    openGoogleCalendarAuthSettings(this.app);
  }

  async handleGcalEventOpen(file: TFile, target: HTMLElement): Promise<void> {
    const row = target.closest<HTMLElement>("[data-event-id]");
    const eventId = row?.dataset.eventId?.trim();
    if (!eventId) throw new Error("Missing calendar event id.");

    const calendarId = row?.dataset.calendarId?.trim() ?? "";
    await openGoogleCalendarEventEditor(
      this.app,
      eventId,
      calendarId,
      async () => {
        await this.refreshWidget(file, "gcal");
      },
      { dateYmd: file.basename, exclude: this.settings.gcalExcludeCalendars ?? [] },
    );
  }

  private async hevyFetch(path: string, options: { method?: string; body?: unknown } = {}): Promise<any> {
    const res = await fetch(`${HEVY_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": this.settings.hevyApiKey.trim(),
      },
      body: options.body ? JSON.stringify(options.body) : null,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Hevy ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  }

  private async listRoutines(maxItems: number): Promise<Array<{ id?: string; title?: string }>> {
    const out: Array<{ id?: string; title?: string }> = [];
    let page = 1;
    while (out.length < maxItems) {
      const data = await this.hevyFetch(`/routines?page=${page}&pageSize=10`);
      const routines = Array.isArray(data?.routines) ? data.routines : [];
      out.push(...routines);
      if (page >= Number(data?.page_count ?? 1)) break;
      page += 1;
    }
    return out.slice(0, maxItems);
  }

  private sanitizeExercisesForPost(exercises: unknown): unknown[] {
    const exs = Array.isArray(exercises) ? exercises : [];
    return exs
      .map((ex) => {
        const e = ex as Record<string, any>;
        return {
          exercise_template_id: e.exercise_template_id ?? e.exerciseTemplateId ?? e.template_id ?? e.id,
          superset_id: e.superset_id ?? e.supersets_id ?? null,
          notes: e.notes ?? null,
          sets: (Array.isArray(e.sets) ? e.sets : []).map((s: Record<string, any>) => ({
            type: s.type ?? "normal",
            weight_kg: s.weight_kg ?? null,
            reps: s.reps ?? null,
            distance_meters: s.distance_meters ?? null,
            duration_seconds: s.duration_seconds ?? null,
            custom_metric: s.custom_metric ?? null,
            rpe: s.rpe ?? null,
          })),
        };
      })
      .filter((ex) => (ex as Record<string, unknown>).exercise_template_id);
  }

  private makeLocalDateTime(dateStr: string, timeStr: string): Date {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
    if (Number.isNaN(dt.getTime())) throw new Error("Invalid date/time");
    return dt;
  }

  private isTempHevyId(id: string): boolean {
    return /^temp-/i.test(String(id ?? "").trim());
  }

  private looksLikeUuid(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s ?? "").trim());
  }

  private hevyEntriesMatch(
    a: { time?: string; name?: string },
    b: { time?: string; name?: string },
  ): boolean {
    if (String(a.name ?? "").trim() !== String(b.name ?? "").trim()) return false;
    const da = new Date(String(a.time ?? ""));
    const db = new Date(String(b.time ?? ""));
    if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
    return (
      da.getUTCFullYear() === db.getUTCFullYear() &&
      da.getUTCMonth() === db.getUTCMonth() &&
      da.getUTCDate() === db.getUTCDate()
    );
  }

  private pruneTempHevyDuplicates(
    items: Array<{ id: string; time?: string; name?: string; volume?: number }>,
  ): Array<{ id: string; time?: string; name?: string; volume?: number }> {
    const real = items.filter((i) => !this.isTempHevyId(i.id));
    const temps = items.filter((i) => this.isTempHevyId(i.id));
    const keptTemps = temps.filter((temp) => !real.some((r) => this.hevyEntriesMatch(r, temp)));
    return [...real, ...keptTemps];
  }

  private sortRoutinesByRecentWorkouts(
    routines: Array<{ id?: string; title?: string }>,
  ): Array<{ id?: string; title?: string }> {
    const logFile = this.app.vault.getAbstractFileByPath(this.settings.hevyLogPath);
    const workouts =
      logFile instanceof TFile ? this.app.metadataCache.getFileCache(logFile)?.frontmatter?.hevy_workouts : [];
    const list = Array.isArray(workouts) ? (workouts as Array<Record<string, unknown>>) : [];
    const lastUsed = new Map<string, number>();
    for (const w of list) {
      const id = String(w?.id ?? "");
      if (this.isTempHevyId(id)) continue;
      const name = String(w?.name ?? "").trim();
      const t = new Date(String(w?.time ?? "")).getTime();
      if (!name || Number.isNaN(t)) continue;
      lastUsed.set(name, Math.max(lastUsed.get(name) ?? 0, t));
    }
    return [...routines].sort((a, b) => {
      const ta = lastUsed.get(String(a.title ?? "").trim()) ?? 0;
      const tb = lastUsed.get(String(b.title ?? "").trim()) ?? 0;
      if (tb !== ta) return tb - ta;
      return String(a.title ?? "").localeCompare(String(b.title ?? ""));
    });
  }

  private extractWorkoutObjectFromCreateResponse(created: unknown): Record<string, unknown> | null {
    const c = created as Record<string, unknown>;
    const candidates = [
      c?.workout,
      (c?.data as Record<string, unknown>)?.workout,
      (c?.event as Record<string, unknown>)?.workout,
      c?.data,
      c,
    ].filter(Boolean);
    for (const item of candidates) {
      const obj = item as Record<string, unknown>;
      if (obj && typeof obj === "object" && (obj.title || obj.start_time || obj.exercises)) return obj;
    }
    return null;
  }

  private async findCreatedWorkoutInRecent(opts: {
    title?: string;
    start_time?: string;
  }): Promise<Record<string, unknown> | null> {
    const data = await this.hevyFetch("/workouts?page=1&pageSize=10");
    const workouts = Array.isArray(data?.workouts) ? data.workouts : [];
    const t = String(opts.title ?? "").trim();
    const s = String(opts.start_time ?? "").trim();
    let hit = workouts.find(
      (w: Record<string, unknown>) => String(w?.title ?? "").trim() === t && String(w?.start_time ?? "").trim() === s,
    );
    if (hit?.id) return hit;
    const want = new Date(s);
    if (!Number.isNaN(want.getTime())) {
      hit = workouts.find((w: Record<string, unknown>) => {
        if (String(w?.title ?? "").trim() !== t) return false;
        const got = new Date(String(w?.start_time ?? ""));
        if (Number.isNaN(got.getTime())) return false;
        return (
          got.getUTCFullYear() === want.getUTCFullYear() &&
          got.getUTCMonth() === want.getUTCMonth() &&
          got.getUTCDate() === want.getUTCDate() &&
          got.getUTCHours() === want.getUTCHours()
        );
      });
      if (hit?.id) return hit;
    }
    return null;
  }

  private async writeHevyLogItems(
    items: Array<{ id: string; time?: string; name?: string; volume?: number }>,
  ): Promise<void> {
    const logFile = this.app.vault.getAbstractFileByPath(this.settings.hevyLogPath);
    if (!(logFile instanceof TFile)) throw new Error(`Hevy log missing: ${this.settings.hevyLogPath}`);

    const merged = this.pruneTempHevyDuplicates(items).sort(
      (a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime(),
    );

    const md = await this.app.vault.read(logFile);
    const text = md.replace(/\r\n/g, "\n");
    const fmEnd = text.startsWith("---\n") ? text.indexOf("\n---\n", 4) : -1;
    const fm = fmEnd !== -1 ? text.slice(0, fmEnd + 5) : "---\nhevy_workouts: []\n---\n";
    const body = fmEnd !== -1 ? text.slice(fmEnd + 5) : text;
    const fmWithout = this.removeHevyWorkoutsBlock(fm);
    const fmLines = fmWithout.split("\n");
    const endFence = fmLines.indexOf("---", 1);
    const inner = fmLines.slice(1, endFence).join("\n").trimEnd();
    const rebuiltInner = (inner ? inner + "\n" : "") + this.buildHevyWorkoutsBlock(merged);
    const rebuiltFm = ["---", rebuiltInner, "---", ""].join("\n");
    await this.app.vault.modify(logFile, rebuiltFm + body);
  }

  private addOneHourToTimeValue(timeStr: string): string {
    const [hh, mm] = timeStr.split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return timeStr;
    const total = (hh * 60 + mm + 60) % (24 * 60);
    const outH = Math.floor(total / 60);
    const outM = total % 60;
    return `${pad2(outH)}:${pad2(outM)}`;
  }

  private async getRecentWorkoutNames(limit: number): Promise<string[]> {
    const logFile = this.app.vault.getAbstractFileByPath(this.settings.hevyLogPath);
    if (!(logFile instanceof TFile)) return [];

    const md = await this.app.vault.read(logFile);
    const items = parseHevyWorkoutsFromMarkdown(md)
      .filter((w) => !this.isTempHevyId(w.id))
      .sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());

    const seen = new Set<string>();
    const out: string[] = [];
    for (const w of items) {
      const name = String(w.name ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= limit) break;
    }
    return out;
  }

  private async buildRoutineDialog(
    routines: Array<{ id?: string; title?: string }>,
    defaults: { date: string; start: string; end: string },
    recentWorkouts: string[],
  ): Promise<{ routineId: string | null; date: string; start: string; end: string; close: () => void } | null> {
    return await new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;";
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(null);
        }
      });

      const card = document.createElement("div");
      card.style.cssText =
        "width:min(520px,92vw);background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:12px;padding:14px;box-shadow:0 6px 30px rgba(0,0,0,0.35);color:var(--text-normal);";
      overlay.appendChild(card);
      const title = document.createElement("div");
      title.textContent = "Create Hevy workout (from routine)";
      title.style.cssText = "font-size:16px;font-weight:600;margin-bottom:10px;";
      card.appendChild(title);

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Start typing...";
      input.style.cssText =
        "width:100%;margin:6px 0 10px 0;padding:8px 10px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);";
      input.setAttribute("list", "hevy-routine-list");
      card.appendChild(input);
      const datalist = document.createElement("datalist");
      datalist.id = "hevy-routine-list";
      const labelToId = new Map<string, string>();
      for (const r of routines) {
        const label = r.title ?? "Untitled routine";
        const opt = document.createElement("option");
        opt.value = label;
        datalist.appendChild(opt);
        if (r.id) labelToId.set(label, String(r.id));
      }
      card.appendChild(datalist);

      if (recentWorkouts.length) {
        const recentRow = document.createElement("div");
        recentRow.style.cssText = "display:flex;justify-content:center;gap:8px;margin:4px 0 12px 0;flex-wrap:wrap;";
        for (const name of recentWorkouts) {
          const pick = document.createElement("button");
          pick.type = "button";
          pick.textContent = firstEmoji(name);
          pick.title = name;
          pick.style.cssText =
            "font-size:20px;line-height:1;width:36px;height:36px;padding:0;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);cursor:pointer;";
          pick.addEventListener("click", () => {
            input.value = name;
            input.focus();
          });
          recentRow.appendChild(pick);
        }
        card.appendChild(recentRow);
      }

      const mk = (type: "date" | "time", value: string): HTMLInputElement => {
        const el = document.createElement("input");
        el.type = type;
        el.value = value;
        el.style.cssText =
          "display:block;width:100%;margin-top:6px;padding:8px 10px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);";
        card.appendChild(el);
        return el;
      };
      const dateInput = mk("date", defaults.date);
      const startInput = mk("time", defaults.start);
      const endInput = mk("time", defaults.end);
      startInput.addEventListener("change", () => {
        endInput.value = this.addOneHourToTimeValue(startInput.value);
      });

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;justify-content:center;gap:12px;margin-top:14px;";

      const btnStyle =
        "padding:6px 16px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);cursor:pointer;";

      const ok = document.createElement("button");
      ok.textContent = "Create";
      ok.style.cssText = btnStyle;
      ok.onclick = () =>
        resolve({
          routineId: labelToId.get(input.value) ?? null,
          date: dateInput.value,
          start: startInput.value,
          end: endInput.value,
          close: () => overlay.remove(),
        });

      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.style.cssText = btnStyle;
      cancel.onclick = () => {
        overlay.remove();
        resolve(null);
      };

      btnRow.appendChild(ok);
      btnRow.appendChild(cancel);
      card.appendChild(btnRow);

      document.body.appendChild(overlay);
      input.focus();
    });
  }

  private yamlStr(s: string): string {
    const esc = String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "")
      .replace(/\n/g, "\\n");
    return `"${esc}"`;
  }

  private unquoteYaml(v: string): string {
    const s = String(v ?? "").trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      const inner = s.slice(1, -1);
      return inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return s;
  }

  private parseHevyWorkoutsFromFrontmatter(fmText: string): Array<{ id: string; time?: string; name?: string; volume?: number }> {
    return parseHevyWorkoutsFromMarkdown(fmText.endsWith("---\n") ? fmText : `${fmText}\n---\n`);
  }

  private async upsertHevyLogFromCreatedWorkout(
    created: any,
    opts: { fallbackTitle: string; fallbackStartIso: string },
  ): Promise<void> {
    const logFile = this.app.vault.getAbstractFileByPath(this.settings.hevyLogPath);
    if (!(logFile instanceof TFile)) throw new Error(`Hevy log missing: ${this.settings.hevyLogPath}`);
    const md = await this.app.vault.read(logFile);
    const text = md.replace(/\r\n/g, "\n");
    const fmEnd = text.startsWith("---\n") ? text.indexOf("\n---\n", 4) : -1;
    const fm = fmEnd !== -1 ? text.slice(0, fmEnd + 5) : "---\nhevy_workouts: []\n---\n";
    const existing = this.parseHevyWorkoutsFromFrontmatter(fm);

    let w = this.extractWorkoutObjectFromCreateResponse(created);
    let id = String(w?.id ?? created?.id ?? created?.workout?.id ?? "");
    const fallbackTitle = String(w?.title ?? opts.fallbackTitle ?? "Untitled workout");
    const fallbackStart = String(w?.start_time ?? opts.fallbackStartIso ?? "");

    if (!this.looksLikeUuid(id)) {
      const found = await this.findCreatedWorkoutInRecent({ title: fallbackTitle, start_time: fallbackStart });
      if (found?.id) {
        w = found;
        id = String(found.id);
      }
    }

    if (!this.looksLikeUuid(id)) {
      // Skip temp placeholder — sync will add the official entry shortly.
      await this.syncHevyWorkouts();
      return;
    }

    const entry = {
      id,
      time: String(w?.start_time ?? w?.created_at ?? fallbackStart),
      name: String(w?.title ?? fallbackTitle),
      volume: this.computeVolumeKg(w as { exercises?: Array<{ sets?: Array<{ weight_kg?: number; reps?: number }> }> }) || 0,
    };

    const map = new Map(existing.map((x) => [x.id, x]));
    map.set(entry.id, entry);
    await this.writeHevyLogItems(Array.from(map.values()));
  }

  private computeVolumeKg(workout: {
    exercises?: Array<{ sets?: Array<{ weight_kg?: number; reps?: number }> }>;
  }): number {
    let total = 0;
    for (const ex of workout?.exercises ?? []) {
      for (const s of ex?.sets ?? []) {
        const w = s?.weight_kg;
        const r = s?.reps;
        if (typeof w === "number" && typeof r === "number") total += w * r;
      }
    }
    return Math.round(total * 10) / 10;
  }

  private removeHevyWorkoutsBlock(fmText: string): string {
    const lines = fmText.split("\n");
    const endFence = lines.indexOf("---", 1);
    if (endFence === -1) return fmText;
    const inner = lines.slice(1, endFence);
    const out: string[] = [];
    let i = 0;
    while (i < inner.length) {
      const line = inner[i];
      if (/^hevy_workouts:\s*$/.test(line)) {
        i += 1;
        while (i < inner.length && (/^\s+/.test(inner[i]) || inner[i].trim() === "")) i += 1;
        continue;
      }
      out.push(line);
      i += 1;
    }
    return ["---", out.join("\n").trimEnd(), "---", ""].join("\n");
  }

  private buildHevyWorkoutsBlock(items: Array<{ id: string; time?: string; name?: string; volume?: number }>): string {
    const lines = ["hevy_workouts:"];
    if (!items.length) {
      lines.push("  []");
      return lines.join("\n");
    }
    for (const it of items) {
      lines.push(`  - id: ${this.yamlStr(it.id)}`);
      lines.push(`    time: ${this.yamlStr(it.time ?? "")}`);
      lines.push(`    name: ${this.yamlStr(it.name ?? "")}`);
      lines.push(`    volume: ${Number(it.volume ?? 0)}`);
    }
    return lines.join("\n");
  }

  syncHevyWorkoutsInBackground(file: TFile): void {
    if (!this.settings.hevyApiKey.trim()) return;

    void this.runHevySyncCoalesced()
      .then(() => this.refreshWidget(file, "hevy"))
      .catch((err) => console.warn("LifeAdmin: Hevy background sync failed:", err));
  }

  private runHevySyncCoalesced(): Promise<number> {
    if (!this.hevySyncPromise) {
      this.hevySyncPromise = this.syncHevyWorkouts().finally(() => {
        this.hevySyncPromise = null;
      });
    }
    return this.hevySyncPromise;
  }

  async syncHevyWorkouts(): Promise<number> {
    if (!this.settings.hevyApiKey.trim()) return 0;

    const logFile = this.app.vault.getAbstractFileByPath(this.settings.hevyLogPath);
    if (!(logFile instanceof TFile)) throw new Error(`Hevy log missing: ${this.settings.hevyLogPath}`);

    const logMd = await this.app.vault.read(logFile);
    const text = logMd.replace(/\r\n/g, "\n");
    const fmEnd = text.startsWith("---\n") ? text.indexOf("\n---\n", 4) : -1;
    const fm = fmEnd !== -1 ? text.slice(0, fmEnd + 5) : "---\nhevy_workouts: []\n---\n";
    const existing = this.parseHevyWorkoutsFromFrontmatter(fm);
    const beforeCount = existing.length;

    const data = await this.hevyFetch("/workouts?page=1&pageSize=10");
    const workouts = Array.isArray(data?.workouts) ? data.workouts : [];
    workouts.sort((a: { start_time?: string; created_at?: string }, b: { start_time?: string; created_at?: string }) => {
      const ta = new Date(a?.start_time ?? a?.created_at ?? 0).getTime();
      const tb = new Date(b?.start_time ?? b?.created_at ?? 0).getTime();
      return tb - ta;
    });

    const existingIds = new Set(existing.map((x) => String(x.id)));
    const legacyRe = /\[hevy_id::\s*([^\]]+)\]/g;
    let legacyMatch: RegExpExecArray | null;
    while ((legacyMatch = legacyRe.exec(logMd)) !== null) existingIds.add(legacyMatch[1].trim());

    const newItems: Array<{ id: string; time: string; name: string; volume: number }> = [];
    for (const w of workouts) {
      const id = String(w?.id ?? "");
      if (!id || existingIds.has(id)) continue;
      newItems.push({
        id,
        time: String(w?.start_time ?? w?.created_at ?? ""),
        name: String(w?.title ?? "Untitled workout"),
        volume: this.computeVolumeKg(w) || 0,
      });
      existingIds.add(id);
    }

    const merged = this.pruneTempHevyDuplicates([...newItems, ...existing]);
    const afterCount = merged.length;
    if (!newItems.length && afterCount === beforeCount) return 0;

    await this.writeHevyLogItems(merged);
    return newItems.length;
  }
}
