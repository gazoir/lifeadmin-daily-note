<%*
const HABITS_FOLDER = "Z_Personal admin/Habits";
const IGNORE_TAG = "dashboard";
const COLOR_YESTERDAY = "#627ac7";
const COLOR_7DAYS = "#c76276";
const noteDate = (tp.file.title ?? "").trim();
const contextDate = /^\d{4}-\d{2}-\d{2}$/.test(noteDate) ? noteDate : tp.date.now("YYYY-MM-DD");

function normalizeYmd(v) {
  if (v == null) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  if (typeof v === "object" && typeof v.toISODate === "function") return v.toISODate();
  return null;
}
function extractEmoji(name) {
  const chars = Array.from(String(name ?? "").trim());
  return chars.length ? chars[0] : "✅";
}
function formatLabel(emoji, details) {
  const d = (details ?? "").trim();
  return d.length ? `${emoji}, ${d}` : emoji;
}
function diffDays(a, b) {
  return moment(a, "YYYY-MM-DD").diff(moment(b, "YYYY-MM-DD"), "days");
}
function addDays(ymd, days) {
  return moment(ymd, "YYYY-MM-DD").add(days, "days").format("YYYY-MM-DD");
}
function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex({ r: Math.round(lerp(A.r, B.r, t)), g: Math.round(lerp(A.g, B.g, t)), b: Math.round(lerp(A.b, B.b, t)) });
}
function colorForOverdueDays(overdueDays) {
  if (overdueDays <= 0) return null;
  if (overdueDays >= 7) return COLOR_7DAYS;
  return lerpColor(COLOR_YESTERDAY, COLOR_7DAYS, (overdueDays - 1) / 6);
}
function parseEntries(text) {
  const re = /^(\d{4}-\d{2}-\d{2})(?:\s*-\s*(.*))?$/;
  return (text ?? "").split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean)
    .map(line => { const m = line.match(re); return m ? { date: m[1], details: m[2] ?? "" } : null; })
    .filter(Boolean);
}
function latestEntry(text) {
  const entries = parseEntries(text);
  if (!entries.length) return null;
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries[entries.length - 1];
}
function hasTag(file, tag) {
  const cache = app.metadataCache.getFileCache(file);
  const tags = cache?.tags?.map(t => t.tag.replace(/^#/, "").toLowerCase()) ?? [];
  return tags.includes(tag.replace(/^#/, "").toLowerCase());
}

async function collectHabits(evalDate, contextDate, previewTomorrow = false) {
  const out = [];
  const files = app.vault.getFiles().filter(f =>
    f.path.startsWith(HABITS_FOLDER + "/") && f.extension === "md" && !hasTag(f, IGNORE_TAG)
  );

  for (const file of files.sort((a, b) => a.basename.localeCompare(b.basename))) {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    const frequency = Number(fm.Frequency ?? fm.frequency ?? 1) || 1;
    const nextDate = normalizeYmd(fm.Next_Date ?? fm.next_date ?? fm.NextDate);
    const hideDate = normalizeYmd(fm.Hide_Date ?? fm.hide_date ?? fm.HideDate ?? fm.Hide);

    if (hideDate && (hideDate === contextDate || hideDate === evalDate)) continue;

    const overdueDays = nextDate ? diffDays(evalDate, nextDate) : 999;
    const isDue = !nextDate || overdueDays >= 0;
    if (!isDue) continue;

    if (previewTomorrow) {
      const overdueToday = nextDate ? diffDays(contextDate, nextDate) : 999;
      const isDueToday = !nextDate || overdueToday >= 0;
      const hiddenToday = hideDate === contextDate;
      if (isDueToday && !hiddenToday) continue;
    }

    const body = await app.vault.read(file);
    const latest = latestEntry(body);
    out.push({
      path: file.path,
      name: file.basename,
      label: formatLabel(extractEmoji(file.basename), latest?.details),
      overdueDays,
      frequency,
      nextDate,
      hideDate,
    });
  }
  return out;
}

let habits = await collectHabits(contextDate, contextDate, false);
let opacity = 1;
if (!habits.length) {
  habits = await collectHabits(addDays(contextDate, 1), contextDate, true);
  opacity = 0.5;
}

let buttons = "";
for (const h of habits) {
  const bg = colorForOverdueDays(h.overdueDays);
  const style = [
    "display:inline-flex", "align-items:center", "white-space:nowrap", "padding:6px 10px",
    "border-radius:8px", "cursor:pointer", `opacity:${opacity}`,
    bg ? `background-color:${bg};color:white;border:none` : "",
  ].filter(Boolean).join(";");
  buttons += `<button type="button" class="dashboard-habit-btn" data-action="habit-log" data-path="${h.path.replace(/"/g, "&quot;")}" data-frequency="${h.frequency}" style="${style}">${h.label}</button> `;
}

if (!buttons) {
  buttons = `<button type="button" class="dashboard-habit-empty" data-action="habit-open" style="opacity:0.5;padding:6px 10px;border-radius:8px;cursor:pointer;">Habits</button>`;
}

tR += `<!-- dashboard:habits:start -->\n<div class="dashboard-widget dashboard-habits" data-widget="habits" data-context-date="${contextDate}" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;margin:0 auto;text-align:center;">\n  ${buttons}\n  <button type="button" class="dashboard-action" data-action="refresh" data-widget="habits" title="Refresh habits" style="cursor:pointer;opacity:${opacity};">↻</button>\n</div>\n<!-- dashboard:habits:end -->`;
%>
