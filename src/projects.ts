import { App, FuzzySuggestModal, type FuzzyMatch, Notice, normalizePath, TFile } from "obsidian";
import type { LifeAdminSettings } from "./settings";
import {
  eventCalendarColor,
  eventStartIso,
  eventTitle,
  fetchUpcomingCalendarEvents,
  filterProjectCandidateEvents,
  collectLinkedGcalIds,
  formatEventWhen,
  hexWithAlpha,
  seriesKey,
  type GCalEvent,
} from "./gcal-events";
import { debugProject } from "./debug";
import { splitLeadingEmoji } from "./emoji-utils";
import { promptProjectEmoji } from "./project-emoji-modal";
import { addIgnoredCalendarEvent, migrateHiddenSeriesToIgnoredFile, readIgnoredSeriesKeys } from "./project-ignored";
import { refreshTodaysDailyNoteProjectsList } from "./projects-dv";
import { runTemplaterOnFile } from "./templater-run";

function notify(msg: string): void {
  new Notice(String(msg));
}

function sanitizeFileName(name: string): string {
  return String(name ?? "Untitled project")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function yamlQuote(value: string): string {
  const v = String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${v}"`;
}

function yamlScalar(key: string, value: string): string {
  if (key === "date" || /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${key}: ${value}`;
  return `${key}: ${yamlQuote(value)}`;
}

function stringifyFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === undefined || raw === null || raw === "") continue;
    if (Array.isArray(raw)) {
      lines.push(`${key}:`);
      for (const item of raw) lines.push(`  - ${item}`);
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      lines.push(`${key}: ${raw}`);
      continue;
    }
    lines.push(yamlScalar(key, String(raw)));
  }
  lines.push("---", "");
  return lines.join("\n");
}

function stripFrontmatter(md: string): string {
  const text = md.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end === -1 ? text : text.slice(end + 5);
}

async function uniqueProjectPath(app: App, folder: string, baseName: string): Promise<string> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
  let path = normalizePath(`${folder}/${baseName}.md`);
  if (!(await adapter.exists(path))) return path;
  for (let i = 2; i < 100; i++) {
    path = normalizePath(`${folder}/${baseName} (${i}).md`);
    if (!(await adapter.exists(path))) return path;
  }
  throw new Error(`Could not find a free filename for "${baseName}"`);
}

function buildProjectContent(templateBody: string, event: GCalEvent): string {
  const startIso = eventStartIso(event);
  const dateYmd = startIso.slice(0, 10);
  const calendarId = event.parent?.id ?? "";

  const frontmatter = stringifyFrontmatter({
    tags: ["project"],
    date: dateYmd,
    "event-id": event.id,
    "gcal-calendar-id": calendarId,
    "gcal-recurring-event-id": event.recurringEventId ?? "",
    "gcal-event-start": startIso,
    location: event.location ?? "",
  });

  let body = stripFrontmatter(templateBody);
  if (!body.includes("#project")) {
    body = `#project\n\n${body}`;
  }

  return frontmatter + body.replace(/^\n+/, "");
}

class ProjectEventPickerModal extends FuzzySuggestModal<GCalEvent> {
  constructor(
    app: App,
    private events: GCalEvent[],
    private readonly onPick: (event: GCalEvent) => void,
    private readonly onHide: (event: GCalEvent) => void,
  ) {
    super(app);
    this.setPlaceholder("Pick a calendar event to create a project…");
    this.setInstructions([
      { text: "One-offs and events recurring every 6+ months only." },
      { text: "Events that already have a project note are hidden." },
      { text: "Tap Hide to dismiss an event from future lists (see Ignored.md)." },
    ]);
  }

  getItems(): GCalEvent[] {
    return this.events;
  }

  getItemText(event: GCalEvent): string {
    return `${eventTitle(event) || "Untitled event"} — ${formatEventWhen(event)}`;
  }

  renderSuggestion(match: FuzzyMatch<GCalEvent>, el: HTMLElement): void {
    const event = match.item;
    const calColor = eventCalendarColor(event);
    el.empty();
    el.addClass("lifeadmin-gcal-suggestion");
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.gap = "8px";
    el.style.borderLeft = `4px solid ${calColor}`;
    el.style.backgroundColor = hexWithAlpha(calColor, 0.2);
    el.style.padding = "6px 8px";
    el.style.borderRadius = "6px";
    el.style.margin = "2px 0";

    const text = el.createDiv({ cls: "lifeadmin-gcal-suggestion-text" });
    text.setText(this.getItemText(event));
    text.style.flex = "1";
    text.style.minWidth = "0";
    text.style.overflow = "hidden";
    text.style.textOverflow = "ellipsis";
    text.style.whiteSpace = "nowrap";

    const hideBtn = el.createEl("button", { text: "Hide", cls: "lifeadmin-gcal-hide" });
    hideBtn.type = "button";
    hideBtn.style.flexShrink = "0";
    hideBtn.style.touchAction = "manipulation";
    hideBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const key = seriesKey(event);
      this.onHide(event);
      this.events = this.events.filter((e) => seriesKey(e) !== key);
      if (!this.events.length) {
        this.close();
        return;
      }
      this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
    hideBtn.addEventListener("pointerup", (evt) => evt.stopPropagation());
  }

  onChooseItem(event: GCalEvent): void {
    this.onPick(event);
  }
}

export class ProjectActions {
  constructor(
    private readonly app: App,
    private readonly settings: LifeAdminSettings,
    private readonly saveSettings: () => Promise<void>,
  ) {}

  async ensureIgnoredStoreReady(): Promise<void> {
    const legacy = this.settings.projectGcalHiddenSeries ?? [];
    if (!legacy.length) return;
    const migrated = await migrateHiddenSeriesToIgnoredFile(this.app, this.settings.projectIgnoredPath, legacy);
    if (migrated.length) {
      this.settings.projectGcalHiddenSeries = [];
      await this.saveSettings();
    }
  }

  private async hiddenSeriesSet(): Promise<Set<string>> {
    await this.ensureIgnoredStoreReady();
    return readIgnoredSeriesKeys(this.app, this.settings.projectIgnoredPath);
  }

  async hideCalendarSeries(event: GCalEvent): Promise<void> {
    await addIgnoredCalendarEvent(this.app, this.settings.projectIgnoredPath, event);
    const label = eventTitle(event) || "event";
    notify(`Hidden from project picker: ${label}`);
    void this.refreshProjectHeaderOnDailyNote().catch(() => undefined);
  }

  async openCreateFromCalendarModal(): Promise<void> {
    debugProject(this.settings.debugProjectButton, "openCreateFromCalendarModal: start");
    notify("Loading Google Calendar events…");
    const linked = collectLinkedGcalIds(this.app);
    const hidden = await this.hiddenSeriesSet();
    debugProject(this.settings.debugProjectButton, "openCreateFromCalendarModal: linked ids", { count: linked.size });
    debugProject(this.settings.debugProjectButton, "openCreateFromCalendarModal: hidden series", { count: hidden.size });
    const raw = await fetchUpcomingCalendarEvents(this.app, this.settings.projectGcalLookAheadDays);
    debugProject(this.settings.debugProjectButton, "openCreateFromCalendarModal: fetched events", { count: raw.length });
    const candidates = filterProjectCandidateEvents(raw, linked, hidden);
    debugProject(this.settings.debugProjectButton, "openCreateFromCalendarModal: candidates", { count: candidates.length });

    if (!candidates.length) {
      notify("No new calendar events to turn into projects.");
      return;
    }

    debugProject(this.settings.debugProjectButton, "openCreateFromCalendarModal: opening modal");
    await this.showPickerModal(candidates);
  }

  private showPickerModal(events: GCalEvent[]): Promise<void> {
    debugProject(this.settings.debugProjectButton, "showPickerModal: opening FuzzySuggestModal", {
      count: events.length,
    });
    return new Promise((resolve) => {
      const modal = new ProjectEventPickerModal(
        this.app,
        events,
        (event) => {
          void this.pickEmojiAndCreateProject(event);
        },
        (event) => {
          void this.hideCalendarSeries(event);
        },
      );
      const baseOnClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        baseOnClose();
        debugProject(this.settings.debugProjectButton, "showPickerModal: closed");
        resolve();
      };
      window.setTimeout(() => {
        modal.open();
        debugProject(this.settings.debugProjectButton, "showPickerModal: modal.open() called");
      }, 0);
    });
  }

  private async pickEmojiAndCreateProject(event: GCalEvent): Promise<void> {
    const label = eventTitle(event) || "Untitled project";
    const emoji = await promptProjectEmoji(this.app, label);
    if (!emoji) return;
    try {
      const file = await this.createProjectFromEvent(event, emoji);
      await this.app.workspace.getLeaf(false).openFile(file);
      await refreshTodaysDailyNoteProjectsList(this.app, this.settings);
    } catch (e) {
      notify(`Create project failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async refreshProjectHeaderOnDailyNote(): Promise<boolean> {
    return refreshTodaysDailyNoteProjectsList(this.app, this.settings);
  }

  async createProjectFromEvent(event: GCalEvent, emoji: string): Promise<TFile> {
    const templatePath = this.settings.projectTemplatePath;
    const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
    if (!(templateFile instanceof TFile)) {
      throw new Error(`Project template not found: ${templatePath}`);
    }

    const baseTitle = splitLeadingEmoji(eventTitle(event) || "Untitled project").rest || "Untitled project";
    const displayTitle = `${emoji} ${baseTitle}`.trim();
    const templateBody = await this.app.vault.read(templateFile);
    const content = buildProjectContent(templateBody, event);
    const baseName = sanitizeFileName(displayTitle);
    const path = await uniqueProjectPath(this.app, this.settings.projectCreateFolder, baseName);
    const file = await this.app.vault.create(path, content);
    await runTemplaterOnFile(this.app, file);
    notify(`Created project: ${file.basename}`);
    return file;
  }
}
