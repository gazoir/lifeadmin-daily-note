import { Notice, Plugin, TFile } from "obsidian";
import { DashboardActions } from "./actions";
import { DashboardBaker } from "./bake";
import { ProjectActions } from "./projects";
import { bakeProjectHeaderMarkdown } from "./project-header";
import { bakeProjectsDvMarkdown, refreshTodaysDailyNoteProjectsList } from "./projects-dv";
import { registerDashboardPostProcessor, rebindDashboardWidgets } from "./post-processor";
import { flushAllGbDailyVaultWrites, flushGbDailyVaultWrite } from "./gb-online-daily-view";
import { LifeAdminSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, type LifeAdminSettings } from "./settings";
import {
  getTemplaterScriptsFolder,
  installTemplaterScripts,
  RECOMMENDED_TEMPLATER_SCRIPTS_FOLDER,
  scheduleEnsureTemplaterScripts,
} from "./templater-scripts";
import { registerIncompleteDailyNoteRepair, DAILY_NOTE_PATH_RE, registerDeferredDailyWidgetsRefresh } from "./daily-notes";
import {
  extractWidgetInnerFromFile,
  widgetInnerShowsDeferredPlaceholder,
} from "./widget-markers";
import { clearSessionDailyWidgetExpanded } from "./gb-online-daily";
import { isShoppingListFile, syncShoppingCalloutVisibility } from "./shopping-list";
import { registerTasksQuickMenu, updateTasksQuickMenu } from "./tasks-quick-menu";
import { ensureGbLogoInVault } from "./gb-logo";
import type { BakeContext } from "./utils";

interface TemplaterLike {
  file: {
    title: string;
    path: (absolute?: boolean) => string;
  };
}

export default class LifeAdminDailyNotePlugin extends Plugin {
  settings: LifeAdminSettings = DEFAULT_SETTINGS;
  baker!: DashboardBaker;
  actions!: DashboardActions;
  projects!: ProjectActions;
  private teardownTasksQuickMenu?: () => void;
  private deferredRecoveryTimer: number | null = null;

  api = {
    bakeWeather: (_tp: any) => Promise.resolve(""),
    bakeHevy: (_tp: any) => Promise.resolve(""),
    bakeWeight: (_tp: any) => Promise.resolve(""),
    bakeHabits: (_tp: any) => Promise.resolve(""),
    bakeWeightHabits: (_tp: any) => Promise.resolve(""),
    bakeDashboardRow: (_tp: any) => Promise.resolve(""),
    bakeGcal: (_tp: any) => Promise.resolve(""),
    bakeGbOnlineDaily: (_tp: any) => Promise.resolve(""),
    bakeProjectHeader: (_tp: any) => Promise.resolve(""),
    bakeProjectsList: () => Promise.resolve(""),
  };

  async onload(): Promise<void> {
    await this.loadSettings();
    void ensureGbLogoInVault(this, this.settings).catch(() => {
      /* vault logo is optional until first successful install */
    });
    this.baker = new DashboardBaker(this.app, this.settings, this.manifest.dir);
    this.actions = new DashboardActions(this.app, this.settings, this.baker);
    this.wireDashboardViewHelpers();
    this.projects = new ProjectActions(this.app, this.settings, () => this.saveSettings());
    void this.projects.ensureIgnoredStoreReady();

    this.api = {
      bakeWeather: (tp: any) => this.baker.bakeWeather(this.toBakeContext(tp)),
      bakeHevy: (tp: any) => this.baker.bakeHevy(this.toBakeContext(tp)),
      bakeWeight: (tp: any) => this.baker.bakeWeight(this.toBakeContext(tp)),
      bakeHabits: (tp: any) => this.baker.bakeHabits(this.toBakeContext(tp)),
      bakeWeightHabits: (tp: any) => this.baker.bakeWeightHabits(this.toBakeContext(tp)),
      bakeDashboardRow: (tp: any) => this.baker.bakeDashboardRow(this.toBakeContext(tp)),
      bakeGcal: (tp: any) => this.baker.bakeGcal(this.toBakeContext(tp)),
      bakeGbOnlineDaily: (tp: any) => this.baker.bakeGbOnlineDaily(this.toBakeContext(tp)),
      bakeProjectHeader: (_tp: any) => bakeProjectHeaderMarkdown(this.app, this.settings),
      bakeProjectsList: () => bakeProjectsDvMarkdown(this.app, this.settings),
    };

    registerDashboardPostProcessor(this as Plugin & { actions: DashboardActions; projects: ProjectActions });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (_leaf, prev) => {
        const prevFile = (prev?.view as { file?: TFile } | undefined)?.file;
        if (prevFile instanceof TFile && DAILY_NOTE_PATH_RE.test(prevFile.path)) {
          void flushGbDailyVaultWrite(this.app, prevFile);
          clearSessionDailyWidgetExpanded(prevFile.path);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        if (isShoppingListFile(this.app, file, this.settings.shoppingListPath)) {
          void syncShoppingCalloutVisibility(this.app, this.settings.shoppingListPath);
        }
        if (file.path === this.settings.gbOnlineDataPath) {
          const active = this.app.workspace.getActiveFile();
          if (active instanceof TFile && DAILY_NOTE_PATH_RE.test(active.path)) {
            void this.actions.repairGbDailyFromStoreIfNeeded(active);
          }
        }
      }),
    );
    this.addSettingTab(new LifeAdminSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-tasks-quick-menu",
      name: "Toggle ⚡ quick task menu",
      callback: async () => {
        this.settings.tasksQuickMenuEnabled = !this.settings.tasksQuickMenuEnabled;
        await this.saveSettings();
        new Notice(
          this.settings.tasksQuickMenuEnabled
            ? "Quick task menu enabled"
            : "Quick task menu disabled — native ⏩ restored",
        );
      },
    });

    this.addCommand({
      id: "refresh-all-dashboard-widgets",
      name: "Refresh all dashboard widgets",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile)) return false;
        if (!checking) {
          this.refreshAllWidgets(file).catch((e) => new Notice(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`));
        }
        return true;
      },
    });

    this.addCommand({
      id: "install-templater-scripts",
      name: "Install Templater user scripts",
      callback: async () => {
        try {
          const folder = getTemplaterScriptsFolder(this.app);
          const installed = await installTemplaterScripts(this, folder);
          new Notice(`Installed ${installed.length} scripts in ${folder}`);
        } catch (e) {
          new Notice(`Install failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    });

    scheduleEnsureTemplaterScripts(this);
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const file = this.app.workspace.getActiveFile();
        if (file instanceof TFile && DAILY_NOTE_PATH_RE.test(file.path)) {
          this.scheduleRecoverStaleDeferredWidgets(file);
        }
      }),
    );
    registerDeferredDailyWidgetsRefresh((_app, file) => this.refreshDeferredDailyNoteWidgets(file));
    registerIncompleteDailyNoteRepair(this, this.settings.dailyTemplatePath);
    this.teardownTasksQuickMenu = registerTasksQuickMenu(this, () => this.settings);

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.debugProjectButton) {
        new Notice("[LifeAdmin] Project button debug is ON — reload note after opening daily note", 5000);
      }
    });

    this.addCommand({
      id: "refresh-daily-note-projects-list",
      name: "Refresh projects list in today's daily note",
      callback: () => {
        void refreshTodaysDailyNoteProjectsList(this.app, this.settings)
          .then((ok) => new Notice(ok ? "Projects list refreshed in daily note" : "Could not refresh projects list"))
          .catch((e) => new Notice(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`));
      },
    });

    this.addCommand({
      id: "create-project-from-gcal",
      name: "Create project from Google Calendar",
      callback: () => {
        this.projects.openCreateFromCalendarModal().catch((e) => {
          new Notice(`Project picker failed: ${e instanceof Error ? e.message : String(e)}`);
        });
      },
    });

    this.addCommand({
      id: "refresh-gb-online-widget",
      name: "Refresh GB Online widget",
      callback: () => {
        void this.refreshGbOnlineWidget().catch((e) =>
          new Notice(`GB Online refresh failed: ${e instanceof Error ? e.message : String(e)}`),
        );
      },
    });

    this.addCommand({
      id: "sync-gb-online-curriculum",
      name: "Sync GB Online curriculum",
      callback: () => {
        void this.syncGbOnlineCurriculum().catch((e) =>
          new Notice(`GB Online sync failed: ${e instanceof Error ? e.message : String(e)}`),
        );
      },
    });

    this.addCommand({
      id: "copy-templater-script-path",
      name: "Copy recommended Templater scripts folder",
      callback: async () => {
        const path = RECOMMENDED_TEMPLATER_SCRIPTS_FOLDER;
        try {
          await navigator.clipboard.writeText(path);
          new Notice(`Copied: ${path}`);
        } catch {
          new Notice(`Recommended folder: ${path}`);
        }
      },
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  onunload(): void {
    registerDeferredDailyWidgetsRefresh(null);
    if (this.deferredRecoveryTimer !== null) window.clearTimeout(this.deferredRecoveryTimer);
    void flushAllGbDailyVaultWrites(this.app);
    this.teardownTasksQuickMenu?.();
  }

  private wireDashboardViewHelpers(): void {
    this.actions.setViewHelpers({
      rebindGbDaily: (file, root) => {
        rebindDashboardWidgets(this as Plugin & { actions: DashboardActions; projects: ProjectActions }, root, file.path);
      },
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    updateTasksQuickMenu(this.app, () => this.settings);
    if (this.baker) {
      this.baker = new DashboardBaker(this.app, this.settings, this.manifest.dir);
      this.actions = new DashboardActions(this.app, this.settings, this.baker);
      this.wireDashboardViewHelpers();
      this.projects = new ProjectActions(this.app, this.settings, () => this.saveSettings());
    }
  }

  private toBakeContext(tp: TemplaterLike): BakeContext {
    const noteDate = String(tp?.file?.title ?? "").trim();
    const path = tp?.file?.path?.(true);
    const abstract = path ? this.app.vault.getAbstractFileByPath(path) : null;
    const file = abstract instanceof TFile ? abstract : undefined;
    return { noteDate, file };
  }


  private scheduleRecoverStaleDeferredWidgets(file: TFile): void {
    if (this.deferredRecoveryTimer !== null) window.clearTimeout(this.deferredRecoveryTimer);
    this.deferredRecoveryTimer = window.setTimeout(() => {
      this.deferredRecoveryTimer = null;
      void this.recoverStaleDeferredWidgets(file);
    }, 400);
  }

  private async recoverStaleDeferredWidgets(file: TFile): Promise<void> {
    if (!DAILY_NOTE_PATH_RE.test(file.path)) return;
    let content: string;
    try {
      content = await this.app.vault.read(file);
    } catch {
      return;
    }

    const stale: Array<"weather" | "habits" | "gcal"> = [];
    for (const widget of ["weather", "habits", "gcal"] as const) {
      const inner = extractWidgetInnerFromFile(content, widget);
      if (widgetInnerShowsDeferredPlaceholder(inner)) stale.push(widget);
    }
    if (!stale.length) return;

    for (const widget of stale) {
      try {
        await this.actions.refreshWidget(file, widget);
      } catch (e) {
        console.warn(`LifeAdmin: stale ${widget} recovery failed:`, e);
      }
    }
    this.app.plugins.plugins?.dataview?.api?.refresh?.();
  }

  private async refreshDeferredDailyNoteWidgets(file: TFile): Promise<void> {
    for (const widget of ["weather", "gcal", "habits"] as const) {
      try {
        await this.actions.refreshWidget(file, widget);
      } catch (e) {
        console.warn(`LifeAdmin: deferred ${widget} refresh failed:`, e);
      }
    }
    this.app.plugins.plugins?.dataview?.api?.refresh?.();
  }

  private async refreshAllWidgets(file: TFile): Promise<void> {
    await Promise.all([
      this.actions.refreshAllDashboardWidgets(file),
      this.projects.refreshProjectHeaderOnDailyNote(),
    ]);
    new Notice("Dashboard widgets refreshed");
  }

  private gbOnlineNoteFile(): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(this.settings.gbOnlineNotePath);
    return file instanceof TFile ? file : null;
  }

  async refreshGbOnlineWidget(): Promise<void> {
    const file = this.gbOnlineNoteFile();
    if (!file) throw new Error(`GB Online note not found: ${this.settings.gbOnlineNotePath}`);
    await this.actions.refreshGbOnlineWidgets(file);
    new Notice("GB Online widgets refreshed");
  }

  async syncGbOnlineCurriculum(): Promise<void> {
    const file = this.gbOnlineNoteFile();
    if (!file) throw new Error(`GB Online note not found: ${this.settings.gbOnlineNotePath}`);
    await this.actions.handleGbSync(file, document.createElement("div"));
  }
}
