```dataviewjs
const { Modal, Setting, Notice, TFile, requestUrl } = require("obsidian");

const HEVY_LOG_PATH = "Z_Personal admin/Exercise/Workouts/Hevy Log.md";
const WEIGHT_DATA_PATH = "Z_Personal admin/Domestic God/🩺 Health/Weight_Data.md";
const HABITS_FOLDER = "Z_Personal admin/Habits";
const HABITS_INDEX_PATH = "Z_Personal admin/Habits/Habits.md";
const HEVY_API_KEY = "c34d839f-1fcb-4eb0-ba9f-8800ddaad219";
const HEVY_BASE = "https://api.hevyapp.com/v1";
const WEATHER_URL = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/London%2C%20UK?unitGroup=metric&include=days&key=3FYLLKVYVJB96XZJLWFYPBN6V&contentType=json";
const WEIGH_IN_SHORTCUT = "Weigh_In_Arboleaf";
const SYNC_SHORTCUT = "Sync_Apple_WeightBF_Obsidian";

const DASHBOARD_LISTENER_KEY = "dashboardHandlersDelegated";

function notify(msg) {
  try { new Notice(String(msg)); } catch {}
}

function getCurrentNoteDateString() {
  const name = String(dv.current()?.file?.name ?? "").replace(/\.md$/i, "");
  return /^\d{4}-\d{2}-\d{2}$/.test(name) ? name : window.moment().format("YYYY-MM-DD");
}

function getFile(path) {
  return app.vault.getAbstractFileByPath(path) || app.vault.getAbstractFileByPath(path + ".md");
}

function pad2(n) { return String(n).padStart(2, "0"); }

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex({ r, g, b }) {
  return "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
}
function tempToColor(t) {
  const CYAN = "#00ffff";
  const BLUE = "#0000ff";
  const YELL = "#ffff00";
  const RED = "#ff0000";
  const mix = (a, b, tt) => {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return rgbToHex({ r: lerp(A.r, B.r, tt), g: lerp(A.g, B.g, tt), b: lerp(A.b, B.b, tt) });
  };
  if (t <= -1) return CYAN;
  if (t >= 40) return RED;
  if (t <= 10) return mix(CYAN, BLUE, clamp01((t + 1) / 11));
  if (t <= 30) return mix(BLUE, YELL, clamp01((t - 10) / 20));
  return mix(YELL, RED, clamp01((t - 30) / 10));
}
function iconEmoji(icon, rain) {
  const map = {
    "clear-day": "☀️", "clear-night": "🌙", "partly-cloudy-day": "🌤️", "partly-cloudy-night": "🌙☁️",
    "cloudy": "☁️", "rain": "🌧️", "showers-day": "🌦️", "showers-night": "🌧️",
    "thunder-rain": "⛈️", "thunder-showers-day": "⛈️", "thunder-showers-night": "⛈️",
    "snow": "🌨️", "sleet": "🌨️", "fog": "🌫️", "wind": "💨",
  };
  if (icon && map[icon]) return map[icon];
  if (Number.isFinite(rain)) {
    if (rain >= 60) return "🌧️";
    if (rain >= 30) return "🌦️";
    return "☀️";
  }
  return "🌤️";
}

async function replaceWidget(widget, innerHtml) {
  const filePath = dv.current().file.path;
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!file) throw new Error("Current note file not found.");

  const start = `<!-- dashboard:${widget}:start -->`;
  const end = `<!-- dashboard:${widget}:end -->`;
  const raw = await app.vault.read(file);
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(raw)) {
    throw new Error(`Dashboard markers not found for widget: ${widget}`);
  }
  const replacement = `${start}\n${innerHtml}\n${end}`;
  const next = raw.replace(pattern, replacement);
  await app.vault.modify(file, next);
  app.plugins?.plugins?.dataview?.api?.refresh?.();
}

async function refreshWeatherWidget() {
  const currentFile = app.vault.getAbstractFileByPath(dv.current().file.path);
  let hi = null;
  let lo = null;
  let rain = null;
  let precipMm = null;
  let windKph = null;
  let icon = "";
  let status = "error";

  try {
    const res = await requestUrl({ url: WEATHER_URL });
    const d = res.json?.days?.[0];
    hi = Number.isFinite(d?.tempmax) ? Math.ceil(d.tempmax) : null;
    lo = Number.isFinite(d?.tempmin) ? Math.floor(d.tempmin) : null;
    rain = Number.isFinite(d?.precipprob) ? Math.floor(d.precipprob) : null;
    icon = d?.icon ?? "unknown";
    precipMm = Number.isFinite(d?.precip) ? Number(d.precip.toFixed(1)) : null;
    windKph = Number.isFinite(d?.windspeed) ? Math.round(d.windspeed) : null;
    status = (hi !== null && lo !== null) ? "ok" : "error";
  } catch {
    status = "error";
  }

  if (currentFile) {
    await app.fileManager.processFrontMatter(currentFile, (fm) => {
      if (status === "ok") {
        fm.highTemp = hi;
        fm.lowTemp = lo;
        fm.rainChance = `${rain}%`;
        fm.icon = icon;
        fm.precipMm = precipMm ?? "—";
        fm.windKph = windKph ?? "—";
      }
      fm.weatherStatus = status;
      fm.weatherUpdated = new Date().toISOString();
    });
  }

  let inner = "";
  if (status === "ok") {
    const emoji = iconEmoji(icon, rain);
    const hiColor = tempToColor(hi);
    const loColor = tempToColor(lo);
    const parts = [
      emoji,
      `<span style="color:${hiColor};font-weight:700;">${hi}</span>-<span style="color:${loColor};font-weight:700;">${lo}</span>°C`,
      `☔ ${rain}%`,
      precipMm !== null ? `🌧️ ${precipMm}mm` : null,
      windKph !== null ? `💨 ${windKph}kph` : null,
    ].filter(Boolean);
    inner = parts.map((s) => `<span style="margin-right:0.7em;">${s}</span>`).join("");
  } else {
    inner = `<button type="button" class="dashboard-action" data-action="refresh" data-widget="weather">↻ Update weather</button>`;
  }

  const html = `<div class="dashboard-widget dashboard-weather" data-widget="weather" style="text-align:center;white-space:nowrap;">
  <span class="dashboard-weather-display">${inner}</span>
  ${status === "ok" ? '<button type="button" class="dashboard-action" data-action="refresh" data-widget="weather" title="Refresh weather" style="margin-left:0.5em;cursor:pointer;">↻</button>' : ""}
</div>`;
  await replaceWidget("weather", html);
}

function parseYmdFromFilename(name) {
  const base = String(name ?? "").replace(/\.md$/i, "");
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

function buildHevyWidgetHtml() {
  const noteDate = getCurrentNoteDateString();
  let base = parseYmdFromFilename(noteDate);
  if (!base) {
    const now = new Date();
    base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const byDay = new Map();
  const logFile = app.vault.getAbstractFileByPath(HEVY_LOG_PATH);
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

  return `<div class="dashboard-widget dashboard-hevy" data-widget="hevy" style="display:flex;justify-content:center;width:100%;">
  <div class="hevy-7day" style="display:inline-flex;gap:6px;align-items:center;">
    ${buttons}
    <button type="button" class="dashboard-action" data-action="refresh" data-widget="hevy" title="Refresh workouts" style="margin-left:4px;cursor:pointer;">↻</button>
  </div>
</div>`;
}

async function refreshHevyWidget() {
  await replaceWidget("hevy", buildHevyWidgetHtml());
}

function numFrom(s) {
  const m = String(s ?? "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}
function fmt(n, d = 1) {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}
function lastN(arr, n) {
  return arr.slice(Math.max(0, arr.length - n));
}
function mean(arr) {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN;
}
function stdev(arr) {
  if (!arr || arr.length < 2) return NaN;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function colorFromT(t) {
  return `hsl(${120 * (1 - clamp(t, 0, 1))}, 80%, 45%)`;
}
function colorByZ(value, target, sd) {
  if (!Number.isFinite(value) || !Number.isFinite(target) || !Number.isFinite(sd) || sd === 0) {
    return "var(--text-normal)";
  }
  return colorFromT(clamp(Math.abs(value - target) / sd / 2, 0, 1));
}
function stripFrontmatter(text) {
  const s = String(text ?? "").replace(/\r\n/g, "\n");
  if (!s.startsWith("---\n")) return s;
  const endIdx = s.indexOf("\n---\n", 4);
  return endIdx === -1 ? s : s.slice(endIdx + 5);
}

async function computeWeightWidgetData() {
  const noteDate = getCurrentNoteDateString();
  const weightFile = getFile(WEIGHT_DATA_PATH);
  let innerHtml = `<span style="opacity:0.7;">⚖️ no data</span>`;
  let bg = "var(--background-secondary)";
  let textColor = "var(--text-normal)";
  let hasToday = false;
  let weightLogged = false;

  const currentFile = app.vault.getAbstractFileByPath(dv.current().file.path);
  if (currentFile) {
    const fm = app.metadataCache.getFileCache(currentFile)?.frontmatter ?? {};
    const wl = fm.Weight_Logged;
    weightLogged = wl === true || String(wl ?? "").toLowerCase() === "true";
  }

  if (weightFile) {
    const rawFull = await app.vault.read(weightFile);
    const fmMatch = rawFull.match(/^---\n([\s\S]*?)\n---/);
    const yaml = fmMatch?.[1] ?? "";
    const targetWeight = numFrom((yaml.match(/^Target_Weight:\s*"?([^"\n]+)"?/m) ?? [])[1]);
    const targetBF = numFrom((yaml.match(/^Target_BF:\s*"?([^"\n]+)"?/m) ?? [])[1]);

    const entries = stripFrontmatter(rawFull).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((line) => {
        const clean = line.replace(/^\-\s*/, "");
        const parts = clean.split(" - ").map((p) => p.trim());
        if (parts.length < 3) return null;
        const weight = numFrom(parts[1]);
        const bf = numFrom(parts[2]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) || !Number.isFinite(weight) || !Number.isFinite(bf)) return null;
        return { dateStr: parts[0], weight, bf };
      })
      .filter(Boolean)
      .sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    const todayStr = noteDate.match(/^\d{4}-\d{2}-\d{2}$/) ? noteDate : window.moment().format("YYYY-MM-DD");
    const todays = entries.filter((e) => e.dateStr === todayStr);
    hasToday = todays.length > 0;
    const todayEntry = hasToday ? todays[todays.length - 1] : null;

    const w7 = lastN(entries, 7);
    const w28 = lastN(entries, 28);
    const avgW7 = mean(w7.map((e) => e.weight));
    const avgBF7 = mean(w7.map((e) => e.bf));
    const sdW28 = stdev(w28.map((e) => e.weight));
    const sdBF28 = stdev(w28.map((e) => e.bf));
    const stateEmoji = hasToday ? "⚖️" : "🔁";

    if (!hasToday) {
      bg = "hsl(0, 70%, 35%)";
      textColor = "#fff";
      innerHtml = `<span style="opacity:0.95;">⚖️</span> <span style="font-weight:900;">${fmt(avgW7, 1)} kg</span> <span style="opacity:0.75;">|</span> <span style="opacity:0.95;">🥧</span> <span style="font-weight:900;">${fmt(avgBF7, 1)}%</span>`;
    } else {
      const wColor = colorByZ(todayEntry.weight, targetWeight, sdW28);
      const bfColor = colorByZ(todayEntry.bf, targetBF, sdBF28);
      innerHtml = `<span style="opacity:0.90;">${stateEmoji}</span> <span style="color:${wColor};font-weight:900;">${fmt(todayEntry.weight, 1)} kg</span> <span style="opacity:0.70;">|</span> <span style="opacity:0.90;">🥧</span> <span style="color:${bfColor};font-weight:900;">${fmt(todayEntry.bf, 1)}%</span>`;
    }
  }

  return { innerHtml, bg, textColor, hasToday, weightLogged };
}

async function refreshWeightWidget() {
  const data = await computeWeightWidgetData();
  const html = `<div class="dashboard-widget dashboard-weight" data-widget="weight" data-has-today="${data.hasToday}" data-weight-logged="${data.weightLogged}" style="display:flex;justify-content:center;width:100%;">
  <button type="button" class="dashboard-weight-btn" data-action="weight-click" style="display:inline-block;padding:6px 10px;border-radius:10px;border:1px solid var(--background-modifier-border);background:${data.bg};font-weight:600;color:${data.textColor};cursor:pointer;">${data.innerHtml}</button>
  <button type="button" class="dashboard-action" data-action="refresh" data-widget="weight" title="Refresh weight" style="margin-left:6px;cursor:pointer;">↻</button>
</div>`;
  await replaceWidget("weight", html);
}

const COLOR_YESTERDAY = "#627ac7";
const COLOR_7DAYS = "#c76276";
const HABIT_IGNORE_TAG = "dashboard";

function normalizeYmd(v) {
  if (v == null) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  if (typeof v === "object" && typeof v.toISODate === "function") return v.toISODate();
  return null;
}
function extractHabitEmoji(name) {
  const chars = Array.from(String(name ?? "").trim());
  return chars.length ? chars[0] : "✅";
}
function formatHabitLabel(emoji, details) {
  const d = (details ?? "").trim();
  return d.length ? `${emoji}, ${d}` : emoji;
}
function diffDays(a, b) {
  return window.moment(a, "YYYY-MM-DD").diff(window.moment(b, "YYYY-MM-DD"), "days");
}
function addDays(ymd, days) {
  return window.moment(ymd, "YYYY-MM-DD").add(days, "days").format("YYYY-MM-DD");
}
function lerpColor(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex({ r: Math.round(lerp(A.r, B.r, t)), g: Math.round(lerp(A.g, B.g, t)), b: Math.round(lerp(A.b, B.b, t)) });
}
function colorForOverdueDays(overdueDays) {
  if (overdueDays <= 0) return null;
  if (overdueDays >= 7) return COLOR_7DAYS;
  return lerpColor(COLOR_YESTERDAY, COLOR_7DAYS, (overdueDays - 1) / 6);
}
function parseEntries(text) {
  const re = /^(\d{4}-\d{2}-\d{2})(?:\s*-\s*(.*))?$/;
  return String(text ?? "").split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)
    .map((line) => {
      const m = line.match(re);
      return m ? { date: m[1], details: m[2] ?? "" } : null;
    })
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
  const tags = cache?.tags?.map((t) => t.tag.replace(/^#/, "").toLowerCase()) ?? [];
  return tags.includes(tag.replace(/^#/, "").toLowerCase());
}

async function collectHabits(evalDate, contextDate, previewTomorrow = false) {
  const out = [];
  const files = app.vault.getFiles().filter((f) =>
    f.path.startsWith(HABITS_FOLDER + "/") && f.extension === "md" && !hasTag(f, HABIT_IGNORE_TAG)
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
      label: formatHabitLabel(extractHabitEmoji(file.basename), latest?.details),
      overdueDays,
      frequency,
    });
  }
  return out;
}

async function buildHabitsWidgetHtml() {
  const contextDate = getCurrentNoteDateString();
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

  return `<div class="dashboard-widget dashboard-habits" data-widget="habits" data-context-date="${contextDate}" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;margin:0 auto;text-align:center;">
  ${buttons}
  <button type="button" class="dashboard-action" data-action="refresh" data-widget="habits" title="Refresh habits" style="cursor:pointer;opacity:${opacity};">↻</button>
</div>`;
}

async function refreshHabitsWidget() {
  await replaceWidget("habits", await buildHabitsWidgetHtml());
}

function formatLogLine(date, details) {
  const d = String(details ?? "").trim();
  return d.length ? `${date} - ${d}` : `${date}`;
}

function upsertTodayLine(text, today, details) {
  const lines = String(text ?? "").split(/\r?\n/);
  const re = /^(\d{4}-\d{2}-\d{2})(?:\s*-\s*(.*))?$/;
  let replaced = false;
  const out = lines.map((line) => {
    const trimmed = line.trimEnd();
    const m = trimmed.match(re);
    if (!m || m[1] !== today) return line;
    replaced = true;
    return formatLogLine(today, details);
  });
  if (!replaced) {
    const trimmedText = String(text ?? "").replace(/\s+$/g, "");
    const newline = formatLogLine(today, details);
    if (!trimmedText) return `${newline}\n`;
    return `${trimmedText}\n${newline}\n`;
  }
  return out.join("\n").replace(/\s+$/g, "") + "\n";
}

function setFrontmatterField(fileText, key, valueRaw) {
  const value = String(valueRaw);
  if (!fileText.startsWith("---")) {
    return `---\n${key}: ${value}\n---\n\n${fileText}`;
  }
  const end = fileText.indexOf("\n---", 3);
  if (end === -1) {
    return `---\n${key}: ${value}\n---\n\n${fileText}`;
  }
  const fmBlock = fileText.slice(0, end + 4);
  const rest = fileText.slice(end + 4);
  const reKey = new RegExp(`^\\s*${key}\\s*:\\s*.*$`, "m");
  const hasKey = reKey.test(fmBlock);
  const newFm = hasKey
    ? fmBlock.replace(reKey, `${key}: ${value}`)
    : fmBlock.replace(/\n---$/, `\n${key}: ${value}\n---`);
  return newFm + rest;
}

class HabitEntryModal extends Modal {
  constructor(appRef, title, onSave, onHideForToday) {
    super(appRef);
    this.titleText = title;
    this.onSave = onSave;
    this.onHideForToday = onHideForToday;
    this.value = "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(`Log: ${this.titleText}`);

    new Setting(contentEl)
      .setName("Details (optional)")
      .addText((text) => {
        text.setPlaceholder("e.g. 80 (or leave blank)")
          .onChange((v) => { this.value = v; });
        setTimeout(() => text.inputEl.focus(), 0);
      });

    const actions = new Setting(contentEl);
    actions.addButton((btn) =>
      btn.setButtonText("Save").setCta().onClick(() => {
        const v = String(this.value ?? "").trimEnd();
        this.close();
        this.onSave(v);
      })
    );
    actions.addButton((btn) =>
      btn.setButtonText("Postpone").onClick(() => {
        this.close();
        this.onHideForToday();
      })
    );
    actions.addExtraButton((btn) =>
      btn.setIcon("cross").setTooltip("Cancel").onClick(() => this.close())
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

async function handleHabitLog(path, frequency) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    notify(`Habit file missing: ${path}`);
    return;
  }

  const contextDate = getCurrentNoteDateString();
  const title = file.basename;
  const freq = Number.isFinite(Number(frequency)) ? Number(frequency) : 1;

  new HabitEntryModal(
    app,
    title,
    async (entered) => {
      const currentFull = await app.vault.read(file);
      const newNext = addDays(contextDate, Math.max(0, freq));
      let updatedFull = setFrontmatterField(currentFull, "Next_Date", newNext);
      updatedFull = upsertTodayLine(updatedFull, contextDate, entered);

      const cache = app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter ?? {};
      const existingHide = normalizeYmd(fm.Hide_Date ?? fm.hide_date ?? fm.HideDate ?? fm.Hide);
      if (existingHide === contextDate) {
        updatedFull = setFrontmatterField(updatedFull, "Hide_Date", "");
      }

      await app.vault.modify(file, updatedFull);
      notify(`Saved & scheduled next: ${newNext}`);
      await refreshHabitsWidget();
    },
    async () => {
      const currentFull = await app.vault.read(file);
      const updatedFull = setFrontmatterField(currentFull, "Hide_Date", contextDate);
      await app.vault.modify(file, updatedFull);
      notify("Hidden for today");
      await refreshHabitsWidget();
    }
  ).open();
}

async function openHabitsIndex() {
  const target = app.vault.getAbstractFileByPath(HABITS_INDEX_PATH);
  if (target instanceof TFile) {
    await app.workspace.getLeaf(true).openFile(target);
  } else {
    notify(`Could not find: ${HABITS_INDEX_PATH}`);
  }
}

function setWeightLoggedTrue(fileText) {
  let text = String(fileText ?? "").replace(/\r\n/g, "\n");
  const marker = "---\n";
  if (text.startsWith(marker)) {
    const parts = text.split(marker);
    if (parts.length >= 3) {
      let yaml = parts[1] ?? "";
      const rest = parts.slice(2).join(marker);
      if (/^Weight_Logged\s*:/m.test(yaml)) {
        yaml = yaml.replace(/^Weight_Logged\s*:\s*.*$/m, "Weight_Logged: true");
      } else {
        if (yaml.length && !yaml.endsWith("\n")) yaml += "\n";
        yaml += "Weight_Logged: true\n";
      }
      return marker + yaml + marker + rest;
    }
  }
  return `---\nWeight_Logged: true\n---\n` + text;
}

async function handleWeightClick() {
  const activeFile = app.vault.getAbstractFileByPath(dv.current().file.path);
  if (!(activeFile instanceof TFile)) return;

  const fm = app.metadataCache.getFileCache(activeFile)?.frontmatter ?? {};
  const wl = fm.Weight_Logged;
  const hasLogged = wl === true || String(wl ?? "").toLowerCase() === "true";
  const weighInUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(WEIGH_IN_SHORTCUT)}`;
  const syncUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(SYNC_SHORTCUT)}`;

  if (!hasLogged) {
    const currentText = await app.vault.read(activeFile);
    const updated = setWeightLoggedTrue(currentText);
    const normalizedCurrentText = currentText.replace(/\r\n/g, "\n");
    if (updated !== normalizedCurrentText) {
      await app.vault.modify(activeFile, updated);
    }
    window.location.href = weighInUrl;
    return;
  }

  const data = await computeWeightWidgetData();
  if (!data.hasToday) {
    window.location.href = syncUrl;
  }
}

async function hevyFetch(path, { method = "GET", body = null } = {}) {
  const res = await fetch(`${HEVY_BASE}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": HEVY_API_KEY,
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hevy ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

async function listRoutines(maxItems = 100) {
  const out = [];
  let page = 1;
  while (out.length < maxItems) {
    const data = await hevyFetch(`/routines?page=${page}&pageSize=10`);
    const routines = Array.isArray(data?.routines) ? data.routines : [];
    out.push(...routines);
    const pageCount = Number(data?.page_count ?? 1);
    if (page >= pageCount) break;
    page += 1;
  }
  return out.slice(0, maxItems);
}

async function getRoutineDetail(routineId) {
  return await hevyFetch(`/routines/${routineId}`);
}

function sanitizeExercisesForPost(exercises) {
  const exs = Array.isArray(exercises) ? exercises : [];
  return exs.map((ex) => ({
    exercise_template_id: ex?.exercise_template_id ?? ex?.exerciseTemplateId ?? ex?.template_id ?? ex?.id,
    superset_id: ex?.superset_id ?? ex?.supersets_id ?? null,
    notes: ex?.notes ?? null,
    sets: (Array.isArray(ex?.sets) ? ex.sets : []).map((s) => ({
      type: s?.type ?? "normal",
      weight_kg: s?.weight_kg ?? null,
      reps: s?.reps ?? null,
      distance_meters: s?.distance_meters ?? null,
      duration_seconds: s?.duration_seconds ?? null,
      custom_metric: s?.custom_metric ?? null,
      rpe: s?.rpe ?? null,
    })),
  })).filter((ex) => ex.exercise_template_id);
}

function floorToHourLocal(d) {
  const x = new Date(d.getTime());
  x.setMinutes(0, 0, 0);
  return x;
}
function toLocalDateInputValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toLocalTimeInputValue(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function makeLocalDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) throw new Error("Invalid date/time");
  return dt;
}

function buildRoutineDialog({ routines, defaults }) {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.background = "rgba(0,0,0,0.55)";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const card = document.createElement("div");
  card.style.width = "min(520px, 92vw)";
  card.style.background = "var(--background-primary)";
  card.style.border = "1px solid var(--background-modifier-border)";
  card.style.borderRadius = "12px";
  card.style.padding = "14px";
  card.style.boxShadow = "0 6px 30px rgba(0,0,0,0.35)";
  card.style.color = "var(--text-normal)";
  overlay.appendChild(card);

  const title = document.createElement("div");
  title.textContent = "Create Hevy workout (from routine)";
  title.style.fontSize = "16px";
  title.style.fontWeight = "600";
  title.style.marginBottom = "10px";
  card.appendChild(title);

  const routineLabel = document.createElement("label");
  routineLabel.textContent = "Routine";
  routineLabel.style.display = "block";
  routineLabel.style.fontSize = "12px";
  routineLabel.style.opacity = "0.85";
  card.appendChild(routineLabel);

  const routineInput = document.createElement("input");
  routineInput.type = "text";
  routineInput.placeholder = "Start typing...";
  routineInput.style.width = "100%";
  routineInput.style.margin = "6px 0 10px 0";
  routineInput.style.padding = "8px 10px";
  routineInput.style.borderRadius = "8px";
  routineInput.style.border = "1px solid var(--background-modifier-border)";
  routineInput.style.background = "var(--background-secondary)";
  routineInput.style.color = "var(--text-normal)";
  routineInput.setAttribute("list", "hevy-routine-list");
  card.appendChild(routineInput);

  const datalist = document.createElement("datalist");
  datalist.id = "hevy-routine-list";
  const labelToId = new Map();
  for (const r of routines) {
    const label = `${r?.title ?? "Untitled routine"}`;
    const opt = document.createElement("option");
    opt.value = label;
    datalist.appendChild(opt);
    if (r?.id) labelToId.set(label, String(r.id));
  }
  card.appendChild(datalist);

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "1fr 1fr";
  grid.style.gap = "10px";
  grid.style.marginBottom = "12px";
  card.appendChild(grid);

  const dateWrap = document.createElement("div");
  grid.appendChild(dateWrap);
  const dateLabel = document.createElement("label");
  dateLabel.textContent = "Date";
  dateLabel.style.display = "block";
  dateLabel.style.fontSize = "12px";
  dateLabel.style.opacity = "0.85";
  dateWrap.appendChild(dateLabel);
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.value = defaults.date;
  dateInput.style.width = "100%";
  dateInput.style.marginTop = "6px";
  dateInput.style.padding = "8px 10px";
  dateInput.style.borderRadius = "8px";
  dateInput.style.border = "1px solid var(--background-modifier-border)";
  dateInput.style.background = "var(--background-secondary)";
  dateInput.style.color = "var(--text-normal)";
  dateWrap.appendChild(dateInput);

  const startWrap = document.createElement("div");
  grid.appendChild(startWrap);
  const startLabel = document.createElement("label");
  startLabel.textContent = "Start time";
  startLabel.style.display = "block";
  startLabel.style.fontSize = "12px";
  startLabel.style.opacity = "0.85";
  startWrap.appendChild(startLabel);
  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.value = defaults.start;
  startInput.style.width = "100%";
  startInput.style.marginTop = "6px";
  startInput.style.padding = "8px 10px";
  startInput.style.borderRadius = "8px";
  startInput.style.border = "1px solid var(--background-modifier-border)";
  startInput.style.background = "var(--background-secondary)";
  startInput.style.color = "var(--text-normal)";
  startWrap.appendChild(startInput);

  const endWrap = document.createElement("div");
  grid.appendChild(endWrap);
  const endLabel = document.createElement("label");
  endLabel.textContent = "End time";
  endLabel.style.display = "block";
  endLabel.style.fontSize = "12px";
  endLabel.style.opacity = "0.85";
  endWrap.appendChild(endLabel);
  const endInput = document.createElement("input");
  endInput.type = "time";
  endInput.value = defaults.end;
  endInput.style.width = "100%";
  endInput.style.marginTop = "6px";
  endInput.style.padding = "8px 10px";
  endInput.style.borderRadius = "8px";
  endInput.style.border = "1px solid var(--background-modifier-border)";
  endInput.style.background = "var(--background-secondary)";
  endInput.style.color = "var(--text-normal)";
  endWrap.appendChild(endInput);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.justifyContent = "flex-end";
  actions.style.gap = "10px";
  card.appendChild(actions);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.style.padding = "8px 12px";
  cancel.style.borderRadius = "8px";
  cancel.style.border = "1px solid var(--background-modifier-border)";
  cancel.style.background = "var(--background-secondary)";
  cancel.style.color = "var(--text-normal)";
  cancel.addEventListener("click", () => overlay.remove());
  actions.appendChild(cancel);

  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = "Create";
  ok.style.padding = "8px 12px";
  ok.style.borderRadius = "8px";
  ok.style.border = "1px solid var(--interactive-accent)";
  ok.style.background = "var(--interactive-accent)";
  ok.style.color = "var(--text-on-accent)";
  actions.appendChild(ok);

  const resultPromise = new Promise((resolve) => {
    ok.addEventListener("click", () => {
      const label = routineInput.value;
      const id = labelToId.get(label) ?? null;
      resolve({
        routineLabel: label,
        routineId: id,
        date: dateInput.value,
        start: startInput.value,
        end: endInput.value,
        close: () => overlay.remove(),
      });
    });
  });

  if (routines.length) routineInput.value = `${routines[0]?.title ?? "Untitled routine"}`;
  document.body.appendChild(overlay);
  routineInput.focus();
  return resultPromise;
}

function computeVolumeKg(workout) {
  let total = 0;
  const exs = workout?.exercises ?? [];
  for (const ex of exs) {
    const sets = ex?.sets ?? [];
    for (const s of sets) {
      const w = s?.weight_kg;
      const r = s?.reps;
      if (typeof w === "number" && typeof r === "number") total += w * r;
    }
  }
  return Math.round(total * 10) / 10;
}
function yamlStr(s) {
  const x = String(s ?? "");
  const esc = x.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n");
  return `"${esc}"`;
}
function unquoteYaml(v) {
  const s = String(v ?? "").trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    const inner = s.slice(1, -1);
    return inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return s;
}
function splitFrontmatter(md) {
  const text = md.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { fm: null, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { fm: null, body: text };
  return { fm: text.slice(0, end + 5), body: text.slice(end + 5) };
}
function ensureFrontmatter(md) {
  const { fm, body } = splitFrontmatter(md);
  if (fm) return { fm, body };
  return { fm: "---\nhevy_workouts: []\n---\n", body };
}
function parseHevyWorkoutsFromFrontmatter(fmText) {
  const lines = fmText.split("\n");
  const endFence = lines.indexOf("---", 1);
  if (endFence === -1) return [];
  const inner = lines.slice(1, endFence);
  const idx = inner.findIndex((l) => /^hevy_workouts:\s*$/.test(l));
  if (idx === -1) return [];
  const items = [];
  let cur = null;
  for (let i = idx + 1; i < inner.length; i++) {
    const line = inner[i];
    if (/^[A-Za-z0-9_ -]+:\s*$/.test(line) && !/^\s/.test(line)) break;
    if (!/^\s/.test(line) && line.trim() !== "") break;
    const mItem = line.match(/^\s*-\s+id:\s*(.+)\s*$/);
    if (mItem) {
      if (cur) items.push(cur);
      cur = { id: unquoteYaml(mItem[1]) };
      continue;
    }
    if (!cur) continue;
    const mKV = line.match(/^\s{4}([a-zA-Z0-9_]+):\s*(.+)\s*$/);
    if (mKV) {
      const k = mKV[1];
      const vRaw = mKV[2];
      if (k === "time" || k === "name") cur[k] = unquoteYaml(vRaw);
      else if (k === "volume") cur[k] = Number(vRaw);
    }
  }
  if (cur) items.push(cur);
  return items.filter((x) => x?.id);
}
function removeHevyWorkoutsBlock(fmText) {
  const lines = fmText.split("\n");
  const endFence = lines.indexOf("---", 1);
  if (endFence === -1) return fmText;
  const inner = lines.slice(1, endFence);
  const out = [];
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
  const rebuiltInner = out.join("\n").trimEnd();
  return ["---", rebuiltInner, "---", ""].join("\n");
}
function buildHevyWorkoutsBlock(items) {
  const lines = ["hevy_workouts:"];
  if (!items.length) {
    lines.push("  []");
    return lines.join("\n");
  }
  for (const it of items) {
    lines.push(`  - id: ${yamlStr(it.id)}`);
    lines.push(`    time: ${yamlStr(it.time ?? "")}`);
    lines.push(`    name: ${yamlStr(it.name ?? "")}`);
    lines.push(`    volume: ${Number(it.volume ?? 0)}`);
  }
  return lines.join("\n");
}
function looksLikeUuid(s) {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}
function extractWorkoutObjectFromCreateResponse(created) {
  const candidates = [
    created?.workout, created?.data?.workout, created?.event?.workout, created?.result?.workout,
    created?.payload?.workout, created?.workout?.workout, created?.data, created,
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && typeof c === "object" && (c.title || c.start_time || c.exercises)) return c;
  }
  const seen = new Set();
  function walk(node) {
    if (!node || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (node.title || node.start_time || node.exercises) return node;
    if (Array.isArray(node)) {
      for (const x of node) {
        const hit = walk(x);
        if (hit) return hit;
      }
      return null;
    }
    for (const k of Object.keys(node)) {
      const hit = walk(node[k]);
      if (hit) return hit;
    }
    return null;
  }
  return walk(created);
}
async function findCreatedWorkoutInRecent({ title, start_time }) {
  const data = await hevyFetch(`/workouts?page=1&pageSize=10`);
  const workouts = Array.isArray(data?.workouts) ? data.workouts : [];
  const t = String(title ?? "").trim();
  const s = String(start_time ?? "").trim();
  let hit = workouts.find((w) => String(w?.title ?? "").trim() === t && String(w?.start_time ?? "").trim() === s);
  if (hit?.id) return hit;
  const want = new Date(s);
  if (!Number.isNaN(want.getTime())) {
    hit = workouts.find((w) => {
      if (String(w?.title ?? "").trim() !== t) return false;
      const got = new Date(String(w?.start_time ?? ""));
      if (Number.isNaN(got.getTime())) return false;
      return got.getUTCFullYear() === want.getUTCFullYear()
        && got.getUTCMonth() === want.getUTCMonth()
        && got.getUTCDate() === want.getUTCDate()
        && got.getUTCHours() === want.getUTCHours();
    });
    if (hit?.id) return hit;
  }
  return null;
}
async function upsertHevyLogFromCreatedWorkout(created, { fallbackTitle, fallbackStartIso } = {}) {
  let w = extractWorkoutObjectFromCreateResponse(created);
  let id = String(w?.id ?? "");
  if (!looksLikeUuid(id)) {
    const found = await findCreatedWorkoutInRecent({
      title: w?.title ?? fallbackTitle,
      start_time: w?.start_time ?? fallbackStartIso,
    });
    if (!found?.id) throw new Error("Created workout missing id (and could not be found in recent workouts)");
    w = found;
    id = String(found.id);
  }
  const time = String(w?.start_time ?? w?.created_at ?? fallbackStartIso ?? "");
  const name = String(w?.title ?? fallbackTitle ?? "Untitled workout");
  const volume = computeVolumeKg(w) || 0;
  const logFile = app.vault.getAbstractFileByPath(HEVY_LOG_PATH);
  if (!logFile) throw new Error(`Hevy Log not found: ${HEVY_LOG_PATH}`);

  const logMd = await app.vault.read(logFile);
  const { fm, body } = ensureFrontmatter(logMd);
  const existing = parseHevyWorkoutsFromFrontmatter(fm);
  const map = new Map(existing.map((x) => [String(x.id), x]));
  map.set(id, { id, time, name, volume });

  const merged = Array.from(map.values()).sort((a, b) => {
    const ta = new Date(a.time || 0).getTime();
    const tb = new Date(b.time || 0).getTime();
    return tb - ta;
  });
  const fmWithout = removeHevyWorkoutsBlock(fm);
  const fmLines = fmWithout.split("\n");
  const endFence = fmLines.indexOf("---", 1);
  const inner = fmLines.slice(1, endFence).join("\n").trimEnd();
  const rebuiltInner = (inner ? inner + "\n" : "") + buildHevyWorkoutsBlock(merged);
  const rebuiltFm = ["---", rebuiltInner, "---", ""].join("\n");
  await app.vault.modify(logFile, rebuiltFm + body);
}

async function runCreateFromRoutineDialog(defaultDateYmd) {
  const now = new Date();
  const end = floorToHourLocal(now);
  const start = new Date(end.getTime() - 3600000);
  const defaults = {
    date: (typeof defaultDateYmd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(defaultDateYmd))
      ? defaultDateYmd
      : toLocalDateInputValue(now),
    start: toLocalTimeInputValue(start),
    end: toLocalTimeInputValue(end),
  };

  const routines = await listRoutines(100);
  if (!routines.length) throw new Error("No routines returned from Hevy.");
  const dialogResult = await buildRoutineDialog({ routines, defaults });
  if (!dialogResult) return;

  const { routineId, date, start: startStr, end: endStr, close } = dialogResult;
  if (!routineId) {
    notify("Pick a routine from the list (type and select an existing option).");
    return;
  }
  if (!date || !startStr || !endStr) {
    notify("Date/start/end are required.");
    return;
  }

  const startDt = makeLocalDateTime(date, startStr);
  const endDt = makeLocalDateTime(date, endStr);
  if (endDt.getTime() <= startDt.getTime()) {
    notify("End time must be after start time.");
    return;
  }

  const detail = await getRoutineDetail(routineId);
  const routine = detail?.routine ?? detail;
  const title = routine?.title ?? "New Workout";
  const exercises = sanitizeExercisesForPost(routine?.exercises);
  const payload = {
    workout: {
      title,
      description: `From routine: ${routine?.title ?? routineId}`,
      start_time: startDt.toISOString(),
      end_time: endDt.toISOString(),
      is_private: false,
      exercises,
    },
  };

  const created = await hevyFetch("/workouts", { method: "POST", body: payload });
  await upsertHevyLogFromCreatedWorkout(created, {
    fallbackTitle: payload.workout.title,
    fallbackStartIso: payload.workout.start_time,
  });
  const newId = created?.id ?? created?.workout?.id ?? created?.data?.id ?? created?.data?.workout?.id ?? "(unknown id)";
  notify(`Hevy: Created workout "${title}" (${newId})`);
  close?.();
  await refreshHevyWidget();
}

async function refreshWidget(widget) {
  if (widget === "weather") return await refreshWeatherWidget();
  if (widget === "hevy") return await refreshHevyWidget();
  if (widget === "weight") return await refreshWeightWidget();
  if (widget === "habits") return await refreshHabitsWidget();
  throw new Error(`Unknown widget: ${widget}`);
}

function getDashboardPreviewContainer() {
  const preview = dv.container?.closest(".markdown-preview-view");
  if (!preview) return null;
  return preview.querySelector(".markdown-preview-sizer") || preview;
}

const previewContainer = getDashboardPreviewContainer();
if (!previewContainer) return;
if (previewContainer.dataset[DASHBOARD_LISTENER_KEY] === "1") return;
previewContainer.dataset[DASHBOARD_LISTENER_KEY] = "1";

previewContainer.addEventListener("click", async (evt) => {
  const target = evt.target instanceof Element ? evt.target.closest("[data-action]") : null;
  if (!target || !previewContainer.contains(target)) return;

  const action = target.dataset.action;
  if (!action) return;

  evt.preventDefault();
  evt.stopPropagation();

  try {
    if (action === "refresh") {
      const widget = target.dataset.widget;
      if (!widget) return;
      target.disabled = true;
      await refreshWidget(widget);
      target.disabled = false;
      return;
    }

    if (action === "hevy-create") {
      const date = target.dataset.date;
      target.disabled = true;
      await runCreateFromRoutineDialog(date);
      target.disabled = false;
      return;
    }

    if (action === "weight-click") {
      await handleWeightClick();
      return;
    }

    if (action === "habit-log") {
      const path = target.dataset.path;
      const frequency = target.dataset.frequency;
      if (!path) return;
      await handleHabitLog(path, frequency);
      return;
    }

    if (action === "habit-open") {
      await openHabitsIndex();
      return;
    }
  } catch (e) {
    notify(`Dashboard action failed: ${e?.message ?? String(e)}`);
    try { target.disabled = false; } catch {}
  }
});
```
