import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type LifeAdminDailyNotePlugin from "./main";
import type { LifeAdminSettings } from "./settings";
import { getTemplaterScriptsFolder, installTemplaterScripts, RECOMMENDED_TEMPLATER_SCRIPTS_FOLDER } from "./templater-scripts";

export class LifeAdminSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: LifeAdminDailyNotePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "LifeAdmin Daily Note Settings" });

    new Setting(containerEl)
      .setName("⚡ Quick task menu")
      .setDesc(
        "Replaces the Tasks ⏩ button with ⚡ globally. Click opens date/timing menu; hold or right-click opens full Tasks edit. " +
          "Turn off here for instant rollback — native ⏩ returns after reload.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.tasksQuickMenuEnabled).onChange(async (value) => {
          this.plugin.settings.tasksQuickMenuEnabled = value;
          await this.plugin.saveSettings();
          new Notice(
            value
              ? "Quick task menu ON — reload open notes if ⚡ buttons are missing"
              : "Quick task menu OFF — native ⏩ restored",
          );
        }),
      );

    new Setting(containerEl)
      .setName("Quick menu long-press (ms)")
      .setDesc("Hold ⚡ this long to open the full Tasks edit modal (desktop and mobile).")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.tasksQuickMenuLongPressMs))
          .onChange(async (value) => {
            const n = Number(value);
            this.plugin.settings.tasksQuickMenuLongPressMs =
              Number.isFinite(n) && n >= 200 ? Math.min(Math.floor(n), 2000) : 500;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Quick menu debug logging")
      .setDesc(
        "Log ⚡ task resolve/save steps to the developer console (Ctrl+Shift+I). Failures also show a Notice. " +
          "Turn off once troubleshooting is done.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.tasksQuickMenuDebug).onChange(async (value) => {
          this.plugin.settings.tasksQuickMenuDebug = value;
          await this.plugin.saveSettings();
          new Notice(value ? "Quick menu debug ON — check console" : "Quick menu debug OFF");
        }),
      );

    new Setting(containerEl)
      .setName("Templater user scripts")
      .setDesc(
        `Daily note templates call tp.user.bake_weather / bake_hevy / bake_weight / bake_habits / bake_gcal / bake_project_header / note_date. ` +
          `Point Templater → User script functions folder to a synced path (recommended: ${RECOMMENDED_TEMPLATER_SCRIPTS_FOLDER}). ` +
          `Current Templater folder: ${getTemplaterScriptsFolder(this.app)}`,
      )
      .addButton((btn) =>
        btn.setButtonText("Install scripts now").onClick(async () => {
          try {
            const folder = getTemplaterScriptsFolder(this.app);
            const installed = await installTemplaterScripts(this.plugin, folder);
            new Notice(`Installed ${installed.length} scripts in ${folder}`);
          } catch (e) {
            new Notice(`Install failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }),
      );

    this.addText("Hevy log path", "Markdown file holding hevy_workouts frontmatter.", "hevyLogPath");
    this.addText("Weight data path", "Markdown file with weight and body-fat entries.", "weightDataPath");
    this.addText("GB Online note", "Note containing the GB Online tracker widget.", "gbOnlineNotePath");
    this.addText("GB Online data file", "Markdown note with a JSON block for catalog cache and watch state.", "gbOnlineDataPath");
    this.addText("GB logo (SVG)", "Vault path for the Gracie Barra header logo.", "gbLogoPath");
    this.addText(
      "GB1 curriculum links",
      "BJJ Curriculum note — used for mobile-friendly GB1 video URLs (collection-nluiatg9ane).",
      "gb1CurriculumPath",
    );
    this.addText("Weekly notes folder", "Folder for ISO weekly notes (reads GB Week frontmatter).", "weeklyNotesFolder");
    this.addText("Habits folder", "Folder containing habit notes.", "habitsFolder");
    this.addText("Habits index path", "Opened by the empty habits button.", "habitsIndexPath");
    this.addText("Hevy API key", "Used for Hevy routine -> workout creation.", "hevyApiKey");
    this.addText("Weather API key", "Visual Crossing API key.", "weatherApiKey");
    this.addText("Weather location", "Location string for weather requests.", "weatherLocation");
    this.addText("Weigh-in shortcut", "Shortcut name for weigh-in flow.", "weighInShortcut");
    this.addText("Sync shortcut", "Shortcut name for weight sync flow.", "syncShortcut");
    this.addText("Weather shortcut", "iOS Shortcut opened when tapping the weather widget.", "weatherShortcut");
    this.addText("Habit ignore tag", "Habits with this tag are excluded from dashboard.", "habitIgnoreTag");
    this.addText("Project template path", "Template used when creating a project from Google Calendar.", "projectTemplatePath");
    this.addText("Project create folder", "Folder for new project notes created from calendar.", "projectCreateFolder");
    this.addText(
      "Ignored calendar events path",
      "Hidden picker entries are stored here. Delete a line to un-hide an event.",
      "projectIgnoredPath",
    );
    new Setting(this.containerEl)
      .setName("Excluded calendars")
      .setDesc("Comma-separated calendar names to hide from the daily note schedule (same as gEvent exclude).")
      .addText((text) =>
        text
          .setValue((this.plugin.settings.gcalExcludeCalendars ?? []).join(", "))
          .onChange(async (value) => {
            this.plugin.settings.gcalExcludeCalendars = value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          }),
      );
    new Setting(this.containerEl)
      .setName("Calendar look-ahead (days)")
      .setDesc("How far ahead to search Google Calendar for the project picker and the ➕ badge count.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.projectGcalLookAheadDays))
          .onChange(async (value) => {
            const n = Number(value);
            this.plugin.settings.projectGcalLookAheadDays = Number.isFinite(n) && n > 0 ? Math.floor(n) : 365;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(this.containerEl)
      .setName("Ignored calendar events")
      .setDesc(`Edit ${this.plugin.settings.projectIgnoredPath} to review or restore hidden events. Hides persist until you delete the line.`)
      .addButton((btn) =>
        btn.setButtonText("Open Ignored file").onClick(async () => {
          const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.projectIgnoredPath);
          if (file) await this.app.workspace.getLeaf(false).openFile(file);
          else new Notice(`File not found: ${this.plugin.settings.projectIgnoredPath}`);
        }),
      );

    new Setting(this.containerEl)
      .setName("Debug project ➕ button")
      .setDesc("Show verbose Notices and console logs when the Projects ➕ button is clicked (for troubleshooting).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugProjectButton).onChange(async (value) => {
          this.plugin.settings.debugProjectButton = value;
          await this.plugin.saveSettings();
          new Notice(value ? "LifeAdmin project button debug ON" : "LifeAdmin project button debug OFF");
        }),
      );
  }

  private addText(name: string, desc: string, key: keyof LifeAdminSettings): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings[key] ?? ""))
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
