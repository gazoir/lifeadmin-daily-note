import type { App, TFile } from "obsidian";
import { normalizePath } from "obsidian";
import type { LifeAdminSettings } from "./settings";
import {
  buildProjectHeaderRowHtml,
  countProjectCandidates,
  PROJECT_HEADER_END,
  PROJECT_HEADER_START,
} from "./project-header";
import { escapeAttr } from "./utils";

export const ONGOING_LIST_DQL =
  'LIST "<br>" + choice((date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days > 6, "❗", "📝 ") + "<small>" + choice((date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days = 0, "Today", "") + choice((date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days = 1, "Yesterday", "") + choice((date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days > 1, (date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days + " days ago", "") + "</small>" FROM #ongoing AND -"Templates" SORT file.mtime DESC';

type DvDate = {
  diff: (other: DvDate, unit: string) => { days: number };
  ts: number;
  toFormat?: (fmt: string) => string;
};

type DvPage = {
  file: { path: string; name: string };
  date?: unknown;
  Date?: unknown;
};

type DataviewPages = {
  where: (fn: (p: DvPage) => boolean) => DataviewPages;
  sort: (fn: (p: DvPage) => unknown, direction?: string) => DataviewPages;
  limit: (n: number) => DvPage[];
  array: () => DvPage[];
  length: number;
  [index: number]: DvPage;
};

type DataviewApi = {
  queryMarkdown: (source: string) => Promise<{ value?: string }>;
  pages: (source: string) => DataviewPages;
  date: (input: string | unknown) => DvDate;
};

function dataviewApi(app: App): DataviewApi | null {
  const api = (app.plugins.plugins.dataview as { api?: DataviewApi } | undefined)?.api;
  if (!api?.queryMarkdown || !api.pages || !api.date) return null;
  return api;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isExcludedProjectPath(path: string): boolean {
  return (
    path.startsWith("Templates/") ||
    path.includes("/Templates/") ||
    path.startsWith("Diaries/") ||
    path.startsWith("Archive/") ||
    path.includes("/Archive/")
  );
}

function toDate(value: unknown, dv: DataviewApi): DvDate | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "toFormat" in value) {
    return value as DvDate;
  }
  const parsed = dv.date(value);
  return parsed?.ts != null ? parsed : null;
}

function pageDate(p: DvPage, dv: DataviewApi): DvDate | null {
  return toDate(p.date ?? p.Date, dv);
}

function daysRemainingFromToday(p: DvPage, dv: DataviewApi): number | null {
  const d = pageDate(p, dv);
  if (!d) return null;
  return Math.round(d.diff(dv.date("today"), "days").days);
}

/** Match TEM_Milestone: only today and future project dates. */
function isUpcomingProject(p: DvPage, dv: DataviewApi): boolean {
  const days = daysRemainingFromToday(p, dv);
  return days !== null && days >= 0;
}

function formatDaysRemaining(p: DvPage, dv: DataviewApi): string {
  const days = daysRemainingFromToday(p, dv);
  if (days === null) return "";
  return days === 0 ? "Today" : String(days);
}

function upcomingProjectPages(app: App): DvPage[] {
  const dv = dataviewApi(app);
  if (!dv) return [];

  const query = dv
    .pages("#project and -#complete and -#ongoing")
    .where((p) => !isExcludedProjectPath(p.file.path) && isUpcomingProject(p, dv))
    .sort((p) => pageDate(p, dv)?.ts ?? Number.MAX_SAFE_INTEGER, "asc");

  if (typeof query.limit === "function") return query.limit(3);
  if (typeof query.array === "function") return query.array().slice(0, 3);
  return Array.from({ length: Math.min(query.length, 3) }, (_, i) => query[i]).filter(Boolean);
}

function buildProjectsTableHtml(pages: DvPage[], dv: DataviewApi, count: number | null): string {
  let rows = buildProjectHeaderRowHtml(count);

  for (const p of pages) {
    const daysLabel = formatDaysRemaining(p, dv);
    const link = `<a class="internal-link" data-href="${escapeAttr(p.file.path)}" href="${escapeAttr(p.file.path)}">${escapeHtml(p.file.name)}</a>`;
    rows += `<tr>
  <td style="padding:5px 8px;vertical-align:middle;color:var(--text-normal)">${link}</td>
  <td style="width:3.25em;padding:4px 2px;vertical-align:middle;text-align:center;white-space:nowrap;font-family:var(--font-monospace,monospace);font-size:0.88em;color:var(--text-normal)">${escapeHtml(daysLabel)}</td>
</tr>`;
  }

  return `<table class="dashboard-widget dashboard-projects-table" style="width:100%;border-collapse:separate;border-spacing:0 3px;font-size:var(--font-ui-small)"><tbody>${rows}</tbody></table>`;
}

export async function bakeProjectsDvMarkdown(app: App, settings?: LifeAdminSettings): Promise<string> {
  const api = dataviewApi(app);
  if (!api) throw new Error("Dataview is not available.");

  let count: number | null = null;
  if (settings) {
    try {
      count = await countProjectCandidates(app, settings);
    } catch {
      count = null;
    }
  }

  const projectPages = upcomingProjectPages(app);
  const projectTable = buildProjectsTableHtml(projectPages, api, count);
  const ongoing = await api.queryMarkdown(ONGOING_LIST_DQL);

  let out = projectTable;
  const ongoingList = (ongoing.value ?? "").trim();
  if (ongoingList) out += `\n${ongoingList}`;

  return `${PROJECT_HEADER_START}\n${out.trim()}\n${PROJECT_HEADER_END}`;
}

export function findProjectsListSlice(content: string): { start: number; end: number } | null {
  const tomorrowIdx = (() => {
    const legacy = content.indexOf("### 🗓️");
    if (legacy >= 0) return legacy;
    const callout = content.indexOf("> [!tomorrow]");
    if (callout >= 0) return callout;
    return -1;
  })();
  if (tomorrowIdx < 0) return null;

  const startMarker = content.lastIndexOf(PROJECT_HEADER_START, tomorrowIdx);
  if (startMarker >= 0) {
    const endMarker = content.indexOf(PROJECT_HEADER_END, startMarker);
    if (endMarker >= 0 && endMarker < tomorrowIdx) {
      return { start: startMarker, end: endMarker + PROJECT_HEADER_END.length };
    }
  }

  const anchor = content.lastIndexOf("dashboard-project-add", tomorrowIdx);
  if (anchor < 0) return null;

  const headerDiv = content.lastIndexOf('class="dashboard-widget dashboard-project-header"', anchor);
  if (headerDiv >= 0) {
    const divStart = content.lastIndexOf("<div", headerDiv);
    if (divStart >= 0) {
      const hrBefore = content.lastIndexOf('<hr style ="margin-top:8px', divStart);
      return { start: hrBefore >= 0 ? hrBefore : divStart, end: tomorrowIdx };
    }
  }

  const tableStart = content.lastIndexOf("dashboard-projects-table", anchor);
  if (tableStart >= 0) {
    const tableOpen = content.lastIndexOf("<table", tableStart);
    if (tableOpen >= 0) return { start: tableOpen, end: tomorrowIdx };
  }

  const hrIdx = content.lastIndexOf('<hr style ="margin-top:8px', anchor);
  if (hrIdx >= 0) return { start: hrIdx, end: tomorrowIdx };

  const tableOpen = content.lastIndexOf("<table", anchor);
  if (tableOpen >= 0 && tableOpen < tomorrowIdx) return { start: tableOpen, end: tomorrowIdx };

  return null;
}

export async function refreshProjectsListInFile(app: App, file: TFile, settings?: LifeAdminSettings): Promise<boolean> {
  const baked = await bakeProjectsDvMarkdown(app, settings);
  const content = await app.vault.read(file);
  const slice = findProjectsListSlice(content);
  if (!slice) return false;

  const before = content.slice(0, slice.start).replace(/\n+$/, "");
  const after = content.slice(slice.end).replace(/^\n+/, "");
  const next = `${before}\n\n${baked}\n\n${after}`;
  await app.vault.modify(file, next);
  return true;
}

export function todaysDailyNoteFile(app: App): TFile | null {
  const moment = (window as unknown as { moment?: (inp?: unknown) => { format: (f: string) => string } }).moment;
  if (!moment) return null;

  const active = app.workspace.getActiveFile();
  if (active?.path.startsWith("Diaries/")) return active;

  const folder = "Diaries";
  const format = "YYYY-MM-DD";
  const path = normalizePath(`${folder}/${moment().format(format)}.md`);
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : null;
}

export async function refreshTodaysDailyNoteProjectsList(
  app: App,
  settings?: LifeAdminSettings,
): Promise<boolean> {
  const file = todaysDailyNoteFile(app);
  if (!file) return false;
  return refreshProjectsListInFile(app, file, settings);
}
