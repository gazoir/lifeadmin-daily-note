import type { App } from "obsidian";
import {
  collectLinkedGcalIds,
  fetchUpcomingCalendarEvents,
  filterProjectCandidateEvents,
} from "./gcal-events";
import { readIgnoredSeriesKeys } from "./project-ignored";
import type { LifeAdminSettings } from "./settings";
import { escapeAttr } from "./utils";

export const PROJECT_HEADER_START = "<!-- dashboard:project-header:start -->";
export const PROJECT_HEADER_END = "<!-- dashboard:project-header:end -->";

export async function countProjectCandidates(app: App, settings: LifeAdminSettings): Promise<number> {
  const linked = collectLinkedGcalIds(app);
  const hidden = await readIgnoredSeriesKeys(app, settings.projectIgnoredPath);
  const raw = await fetchUpcomingCalendarEvents(app, settings.projectGcalLookAheadDays);
  return filterProjectCandidateEvents(raw, linked, hidden).length;
}

export function buildProjectHeaderRowHtml(count: number | null, projectsLink = "--- TODO ---/Projects"): string {
  const badge = count !== null && count > 0 ? ` (${count})` : "";
  const title =
    count !== null && count > 0
      ? `${count} upcoming calendar event${count === 1 ? "" : "s"} without a project`
      : "Create project from Google Calendar";
  const link = `<a class="internal-link" data-href="${escapeAttr(projectsLink)}" href="${escapeAttr(projectsLink)}" style="font-size:var(--h3-size);font-weight:var(--h3-weight);color:var(--link-color);text-decoration:underline;">Projects</a>`;
  const button = `<button type="button" class="dashboard-project-add" data-action="project-create-open" data-project-candidates="${count ?? ""}" title="${escapeAttr(title)}" style="font-size:14px;line-height:1;padding:4px 8px;border-radius:0;border:1px solid var(--background-modifier-border);background:var(--background-secondary);cursor:pointer;">➕${badge}</button>`;
  return `<tr class="dashboard-project-header dashboard-project-actions-row">
  <td style="padding:5px 8px;vertical-align:middle">${link}</td>
  <td style="width:3.25em;padding:4px 2px;vertical-align:middle;text-align:center">${button}</td>
</tr>`;
}

export function buildProjectHeaderHtml(count: number | null, projectsLink = "--- TODO ---/Projects"): string {
  const badge = count !== null && count > 0 ? ` (${count})` : "";
  const title =
    count !== null && count > 0
      ? `${count} upcoming calendar event${count === 1 ? "" : "s"} without a project`
      : "Create project from Google Calendar";
  const inner = `<div class="dashboard-widget dashboard-project-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 4px 0;">
  <a class="internal-link" data-href="${escapeAttr(projectsLink)}" href="${escapeAttr(projectsLink)}" style="font-size:var(--h3-size);font-weight:var(--h3-weight);color:var(--link-color);text-decoration:underline;">Projects</a>
  <button type="button" class="dashboard-project-add" data-action="project-create-open" data-project-candidates="${count ?? ""}" title="${escapeAttr(title)}" style="flex-shrink:0;font-size:14px;line-height:1;padding:4px 10px;border-radius:0;border:1px solid var(--background-modifier-border);background:var(--background-secondary);cursor:pointer;">➕${badge}</button>
</div>`;
  return `${PROJECT_HEADER_START}\n${inner}\n${PROJECT_HEADER_END}`;
}

export async function bakeProjectHeaderMarkdown(_app: App, _settings: LifeAdminSettings): Promise<string> {
  return "";
}

export function replaceProjectHeaderInContent(content: string, headerHtml: string): string | null {
  const marked = new RegExp(
    `${escapeRegex(PROJECT_HEADER_START)}[\\s\\S]*?${escapeRegex(PROJECT_HEADER_END)}`,
  );
  if (marked.test(content)) {
    return content.replace(marked, headerHtml.trimEnd());
  }

  const legacy = /<div class="dashboard-widget dashboard-project-header"[\s\S]*?<\/div>\s*(?=<hr style ="margin-top:-6px)/;
  if (legacy.test(content)) {
    return content.replace(legacy, `${headerHtml.trimEnd()}\n\n`);
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
