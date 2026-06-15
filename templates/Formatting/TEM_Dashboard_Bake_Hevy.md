<%*
const LOG = "Z_Personal admin/Exercise/Workouts/Hevy Log.md";
const noteDate = (tp.file.title ?? "").trim();
const pad2 = (n) => String(n).padStart(2, "0");

function parseYmdFromFilename(name) {
  const base = (name ?? "").replace(/\.md$/i, "");
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function ymdUTC(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function addDaysUTC(d, n) {
  return new Date(d.getTime() + n * 86400000);
}
function firstEmoji(name) {
  const chars = Array.from(String(name ?? "").trim());
  return chars[0] ?? "";
}
function toUTCDateFromISO(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

let base = parseYmdFromFilename(noteDate);
if (!base) {
  const now = new Date();
  base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const byDay = new Map();

const logFile = app.vault.getAbstractFileByPath(LOG);
if (logFile) {
  const cache = app.metadataCache.getFileCache(logFile);
  const workouts = cache?.frontmatter?.hevy_workouts;
  if (Array.isArray(workouts)) {
    for (const w of workouts) {
      const d = toUTCDateFromISO(w?.time);
      if (!d) continue;
      const key = ymdUTC(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
      const prev = byDay.get(key);
      if (!prev || (toUTCDateFromISO(w.time)?.getTime() ?? 0) > (toUTCDateFromISO(prev.time)?.getTime() ?? 0)) {
        byDay.set(key, w);
      }
    }
  }
}

let buttons = "";
for (let i = 6; i >= 0; i--) {
  const day = addDaysUTC(base, -i);
  const key = ymdUTC(day);
  const w = byDay.get(key);
  const emoji = w ? firstEmoji(w.name) : " ";
  const title = w ? `${key} — ${w.name}` : `${key} — log a workout`;
  buttons += `<button type="button" class="dashboard-hevy-day" data-action="hevy-create" data-date="${key}" title="${title.replace(/"/g, "&quot;")}" style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;height:44px;min-width:44px;padding:4px 6px;cursor:pointer;"><div style="font-size:11px;line-height:12px;">${DOW[day.getUTCDay()]}</div><div style="font-size:16px;line-height:16px;">${emoji}</div></button>`;
}

tR += `<!-- dashboard:hevy:start -->\n<div class="dashboard-widget dashboard-hevy" data-widget="hevy" style="display:flex;justify-content:center;width:100%;">\n  <div class="hevy-7day" style="display:inline-flex;gap:6px;align-items:center;">\n    ${buttons}\n    <button type="button" class="dashboard-action" data-action="refresh" data-widget="hevy" title="Refresh workouts" style="margin-left:4px;cursor:pointer;">↻</button>\n  </div>\n</div>\n<!-- dashboard:hevy:end -->`;
%>
