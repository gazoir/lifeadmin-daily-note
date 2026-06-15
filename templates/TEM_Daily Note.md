---
cssclasses:
  - clean-embeds
  - hide-title
  - hide-embedded-header

tags:
  - dailynote
fastedmeals: 0
date: <% tp.file.title %>



---
<%*
// SET DATE FIELD IN FRONTMATTER
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Get current note file reliably (handles “new note still being created” timing)
const path = tp.file.path(true);
let file = app.vault.getAbstractFileByPath(path);

for (let i = 0; i < 10 && !file; i++) {
  await sleep(100);
  file = app.vault.getAbstractFileByPath(path);
}

if (!file) {
  tR += "";
  return;
}

// Prefer filename if it already looks like YYYY-MM-DD, otherwise use today
const filename = (tp.file.title ?? "").trim();
const ymdFromName = /^\d{4}-\d{2}-\d{2}$/.test(filename) ? filename : null;

// Templater date formatted as YYYY-MM-DD
const todayYmd = tp.date.now("YYYY-MM-DD");
const ymd = ymdFromName ?? todayYmd;

await app.fileManager.processFrontMatter(file, (fm) => {
  fm.date = ymd; // creates if absent, overwrites if present
});

tR += "";
%>


<%* const noteDate = await tp.file.title %>
## <%* tR += (moment(noteDate).add(0, 'days')).format('dddd Do MMM YYYY') %>
<hr style="margin-bottom:-8px;margin-top:-8px"></hr>

[[Diaries/Weekly/<%* tR += (moment(noteDate).add(0, 'days')).format('YYYY') %>-W<%* tR += (moment(noteDate).add(0, 'days')).format('WW') %>|Week <%* tR += (moment(noteDate).add(0, 'days')).format('W') %>]] // <% tp.file.include("[[Templates/TEM_Milestone.md]]") %>
<hr style="margin-bottom:-8px;margin-top:-8px"></hr>

```dataviewjs
const links = [
  { path: "Z_Personal admin/Prep/Door Prep/Door Prep List", label: "Door Prep",     emoji: "🚪" },
  { path: "Z_Personal admin/Exercise/Gym Kit/Gym Kit Prep", label: "Gym Kit Prep", emoji: "🏋️" },
  { path: "Z_Personal admin/Prep/Work Prep/Work Prep List", label: "Work Prep",     emoji: "💼" },
];

const row = dv.el("div", "", { cls: "prep-button-row" });

for (const l of links) {
  const a = document.createElement("a");
  a.classList.add("internal-link", "prep-button");
  a.setAttribute("data-href", l.path);
  a.setAttribute("href", l.path); // Obsidian intercepts internal links
  a.textContent = `  ${l.emoji}  `;
  row.appendChild(a);
}

```
```dataviewjs
const p = dv.current();
const { requestUrl, Notice } = require("obsidian");
const notify = (msg) => { try { new Notice(msg); } catch {} };

// --------- parsing helpers ----------
const numOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "error") return null;
  const n = parseFloat(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const strOrEmpty = (v) => (v ?? "").toString().trim();

// --------- temperature -> colour (cyan<=-1 -> blue@10 -> yellow@30 -> red@40) ----------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};
const rgbToHex = ({ r, g, b }) =>
  "#" + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, "0")).join("");

const tempToColor = (t) => {
  const CYAN = "#00ffff";
  const BLUE = "#0000ff";
  const YELL = "#ffff00";
  const RED  = "#ff0000";

  if (t <= -1) return CYAN;
  if (t >= 40) return RED;

  const mix = (a, b, tt) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex({ r: lerp(A.r, B.r, tt), g: lerp(A.g, B.g, tt), b: lerp(A.b, B.b, tt) });
  };

  if (t <= 10) return mix(CYAN, BLUE, clamp01((t - (-1)) / (10 - (-1))));
  if (t <= 30) return mix(BLUE, YELL, clamp01((t - 10) / (30 - 10)));
  return mix(YELL, RED, clamp01((t - 30) / (40 - 30)));
};

// --------- read YAML ----------
const hi = numOrNull(p.highTemp);
const lo = numOrNull(p.lowTemp);
const rain = numOrNull(p.rainChance);
const precipMm = numOrNull(p.precipMm);
const windKph = numOrNull(p.windKph);

const icon = strOrEmpty(p.icon);
const weatherStatus = strOrEmpty(p.weatherStatus).toLowerCase();

// icon -> emoji
const iconEmoji = (() => {
  const map = {
    "clear-day": "☀️", "clear-night": "🌙",
    "partly-cloudy-day": "🌤️", "partly-cloudy-night": "🌙☁️",
    "cloudy": "☁️", "rain": "🌧️",
    "showers-day": "🌦️", "showers-night": "🌧️",
    "thunder-rain": "⛈️", "thunder-showers-day": "⛈️", "thunder-showers-night": "⛈️",
    "snow": "🌨️", "sleet": "🌨️",
    "fog": "🌫️", "wind": "💨"
  };
  if (icon && map[icon]) return map[icon];
  if (rain !== null) {
    if (rain >= 60) return "🌧️";
    if (rain >= 30) return "🌦️";
    return "☀️";
  }
  return "🌤️";
})();

const hasWeather = hi !== null && lo !== null && weatherStatus !== "error";

// --------- render container ----------
const root = dv.el("div", "");
root.style.textAlign = "center";
root.style.whiteSpace = "nowrap";

// --------- updater (writes frontmatter) ----------
async function updateFrontmatterWeather() {
  const url = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/London%2C%20UK?unitGroup=metric&include=days&key=3FYLLKVYVJB96XZJLWFYPBN6V&contentType=json";
  const filePath = dv.current().file.path;
  const file = app.vault.getAbstractFileByPath(filePath);

  try {
    const res = await requestUrl({ url });
    const d = res.json?.days?.[0];

    const hiN = d?.tempmax;
    const loN = d?.tempmin;
    const rainN = d?.precipprob;
    const ic = d?.icon;
    const precip = d?.precip;
    const wind = d?.windspeed;

    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.highTemp = Number.isFinite(hiN) ? Math.ceil(hiN) : "Error";
      fm.lowTemp = Number.isFinite(loN) ? Math.floor(loN) : "Error";
      fm.rainChance = Number.isFinite(rainN) ? Math.floor(rainN) + "%" : "Error";
      fm.icon = ic ?? "unknown";
      fm.precipMm = Number.isFinite(precip) ? Number(precip.toFixed(1)) : "—";
      fm.windKph = Number.isFinite(wind) ? Math.round(wind) : "—";
      fm.weatherStatus = "ok";
      fm.weatherUpdated = new Date().toISOString();
    });

    notify("Weather updated.");
    app.plugins?.plugins?.dataview?.api?.refresh?.();

  } catch (e) {
    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.weatherStatus = "error";
      fm.weatherUpdated = new Date().toISOString();
    });
    notify(`Weather update failed: ${(e?.message ?? String(e)).slice(0, 120)}`);
    app.plugins?.plugins?.dataview?.api?.refresh?.();
  }
}

// --------- UI ----------
if (!hasWeather) {
  const btn = document.createElement("button");
  btn.textContent = "↻ Update weather";
  btn.style.cursor = "pointer";
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Updating…";
    await updateFrontmatterWeather();
    btn.disabled = false;
    btn.textContent = "↻ Update weather";
  };
  root.appendChild(btn);
} else {
  const hiTxt = `${Math.round(hi)}`;
  const loTxt = `${Math.round(lo)}`;
  const rainTxt = rain === null ? "—" : `${Math.round(rain)}%`;
  const precipTxt = precipMm === null ? null : `${precipMm.toFixed(1)}mm`;
  const windTxt = windKph === null ? null : `${Math.round(windKph)}kph`;

  const hiColor = tempToColor(hi);
  const loColor = tempToColor(lo);

  const parts = [
    `${iconEmoji}`,
    `<span style="color:${hiColor}; font-weight:700;">${hiTxt}</span>-<span style="color:${loColor}; font-weight:700;">${loTxt}</span>°C`,
    `☔ ${rainTxt}`,
    precipTxt ? `🌧️ ${precipTxt}` : null,
    windTxt ? `💨 ${windTxt}` : null,
  ].filter(Boolean);

  root.innerHTML = parts.map(s => `<span style="margin-right:0.7em;">${s}</span>`).join("");
}

```
```dataviewjs
// Hevy 7-day emoji calendar (centered) + routine dialog + create workout + update Hevy Log YAML (robust create response)
// - Reads YAML frontmatter from Hevy Log: hevy_workouts: [{ id, time, name, volume }, ...]
// - Buttons are centered on one line
// - Clicking a day opens routine dialog defaulting DATE to that day (YYYY-MM-DD)
// - After successful create, updates Hevy Log YAML immediately (upsert); robust even if create response lacks id

const LOG = "Z_Personal admin/Exercise/Workouts/Hevy Log.md";
const API_KEY = "c34d839f-1fcb-4eb0-ba9f-8800ddaad219";
const BASE = "https://api.hevyapp.com/v1";

function notify(msg) {
  if (typeof Notice !== "undefined") new Notice(msg);
  else console.log(msg);
}

// -------------------- shared helpers --------------------
function pad2(n) { return String(n).padStart(2, "0"); }

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
  const dt = new Date(y, (m - 1), d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) throw new Error("Invalid date/time");
  return dt;
}

async function hevyFetch(path, { method="GET", body=null } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": API_KEY,
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hevy ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

// -------------------- routines (for dialog suggester) --------------------
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
  return exs.map(ex => ({
    exercise_template_id: ex?.exercise_template_id ?? ex?.exerciseTemplateId ?? ex?.template_id ?? ex?.id,
    superset_id: ex?.superset_id ?? ex?.supersets_id ?? null,
    notes: ex?.notes ?? null,
    sets: (Array.isArray(ex?.sets) ? ex.sets : []).map(s => ({
      type: s?.type ?? "normal",
      weight_kg: s?.weight_kg ?? null,
      reps: s?.reps ?? null,
      distance_meters: s?.distance_meters ?? null,
      duration_seconds: s?.duration_seconds ?? null,
      custom_metric: s?.custom_metric ?? null,
      rpe: s?.rpe ?? null,
    })),
  })).filter(ex => ex.exercise_template_id);
}

// -------------------- dialog UI --------------------
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
  routineInput.placeholder = "Start typing…";
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

// -------------------- Hevy Log YAML utilities --------------------
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
  const esc = x
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
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
  const fm = text.slice(0, end + "\n---\n".length);
  const body = text.slice(end + "\n---\n".length);
  return { fm, body };
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
  const lines = [];
  lines.push("hevy_workouts:");
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

// -------- Robust handling for create response that may not include id --------
function looksLikeUuid(s) {
  return typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function extractWorkoutObjectFromCreateResponse(created) {
  const candidates = [
    created?.workout,
    created?.data?.workout,
    created?.event?.workout,
    created?.result?.workout,
    created?.payload?.workout,
    created?.workout?.workout,
    created?.data,
    created,
  ].filter(Boolean);

  for (const c of candidates) {
    if (c && typeof c === "object") {
      if (c.title || c.start_time || c.exercises) return c;
    }
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

  let hit = workouts.find(w =>
    String(w?.title ?? "").trim() === t &&
    String(w?.start_time ?? "").trim() === s
  );
  if (hit?.id) return hit;

  const want = new Date(s);
  if (!Number.isNaN(want.getTime())) {
    hit = workouts.find(w => {
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
    if (!found?.id) {
      throw new Error("Created workout missing id (and could not be found in recent workouts)");
    }
    w = found;
    id = String(found.id);
  }

  const time = String(w?.start_time ?? w?.created_at ?? fallbackStartIso ?? "");
  const name = String(w?.title ?? fallbackTitle ?? "Untitled workout");
  const volume = computeVolumeKg(w) || 0;

  const logFile = app.vault.getAbstractFileByPath(LOG);
  if (!logFile) throw new Error(`Hevy Log not found: ${LOG}`);

  const logMd = await app.vault.read(logFile);
  const { fm, body } = ensureFrontmatter(logMd);

  const existing = parseHevyWorkoutsFromFrontmatter(fm);
  const map = new Map(existing.map(x => [String(x.id), x]));
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

// -------------------- create workflow (dialog -> POST -> update log) --------------------
async function runCreateFromRoutineDialog(defaultDateYmd) {
  const now = new Date();
  const end = floorToHourLocal(now);
  const start = new Date(end.getTime() - 60 * 60 * 1000);

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

  // IMPORTANT: do NOT send routine_id (Hevy rejects it)
  const payload = {
    workout: {
      title,
      description: `From routine: ${routine?.title ?? routineId}`,
      start_time: startDt.toISOString(),
      end_time: endDt.toISOString(),
      is_private: false,
      exercises,
    }
  };

  const created = await hevyFetch("/workouts", { method: "POST", body: payload });

  // Update Hevy Log YAML immediately (robust, even if create response lacks id)
  await upsertHevyLogFromCreatedWorkout(created, {
    fallbackTitle: payload.workout.title,
    fallbackStartIso: payload.workout.start_time,
  });

  const newId =
    created?.id ??
    created?.workout?.id ??
    created?.data?.id ??
    created?.data?.workout?.id ??
    "(unknown id)";
  notify(`Hevy: Created workout "${title}" (${newId})`);
  close?.();
}

// -------------------- calendar helpers --------------------
function parseYmdFromFilename(fileName) {
  const base = (fileName ?? "").replace(/\.md$/i, "");
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [_, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function ymdUTC(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysUTC(dateObj, deltaDays) {
  return new Date(dateObj.getTime() + deltaDays * 24 * 60 * 60 * 1000);
}

function firstEmojiOrBlank(name) {
  if (!name) return "";
  const s = String(name).trim();
  if (!s) return "";
  const chars = Array.from(s);
  return chars[0] ?? "";
}

function toUTCDateFromISO(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// base date from current note filename or today (UTC midnight)
const curFileName = dv.current()?.file?.name;
let base = parseYmdFromFilename(curFileName);
if (!base) {
  const now = new Date();
  base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
}

// load workouts from Hevy Log YAML
const page = dv.page(LOG);
const workouts = Array.isArray(page?.hevy_workouts) ? page.hevy_workouts : [];

// map YYYY-MM-DD -> workout (latest if multiple)
const byDay = new Map();
for (const w of workouts) {
  const d = toUTCDateFromISO(w?.time);
  if (!d) continue;
  const dayKey = ymdUTC(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)));

  const prev = byDay.get(dayKey);
  if (!prev) {
    byDay.set(dayKey, w);
  } else {
    const prevT = toUTCDateFromISO(prev?.time)?.getTime() ?? 0;
    const curT = d.getTime();
    if (curT > prevT) byDay.set(dayKey, w);
  }
}

// -------------------- render (CENTERED single-line row) --------------------
const wrapper = dv.el("div", "", { cls: "hevy-7day-wrap" });
wrapper.style.display = "flex";
wrapper.style.justifyContent = "center";
wrapper.style.width = "100%";

const container = document.createElement("div");
container.className = "hevy-7day";
container.style.display = "inline-flex";
container.style.gap = "6px";
container.style.alignItems = "center";
container.style.flexWrap = "nowrap";
wrapper.appendChild(container);

for (let i = 6; i >= 0; i--) {
  const day = addDaysUTC(base, -i);
  const key = ymdUTC(day); // YYYY-MM-DD (used as dialog default date)
  const dayLabel = DOW[day.getUTCDay()];
  const w = byDay.get(key);
  const emoji = w ? firstEmojiOrBlank(w.name) : "";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = w ? `${key} — ${w.name}` : `${key} — log a workout`;

  btn.style.display = "inline-flex";
  btn.style.flexDirection = "column";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.style.height = "44px";
  btn.style.minWidth = "44px";
  btn.style.padding = "4px 6px";
  btn.style.lineHeight = "1.0";

  const top = document.createElement("div");
  top.textContent = dayLabel;
  top.style.fontSize = "11px";
  top.style.lineHeight = "12px";

  const bottom = document.createElement("div");
  bottom.textContent = emoji || " ";
  bottom.style.fontSize = "16px";
  bottom.style.lineHeight = "16px";

  btn.appendChild(top);
  btn.appendChild(bottom);

  btn.addEventListener("click", async (evt) => {
    evt.preventDefault();
    evt.stopPropagation();

    btn.disabled = true;
    const oldTitle = btn.title;
    btn.title = "Loading…";

    try {
      await runCreateFromRoutineDialog(key);
    } catch (e) {
      notify(`Hevy: Failed — ${e?.message ?? e}`);
    } finally {
      btn.title = oldTitle;
      btn.disabled = false;
    }
  });

  container.appendChild(btn);
}
```

```dataviewjs
const weightDataPath = "Z_Personal admin/Domestic God/🩺 Health/Weight_Data.md";

// ---- shortcut links ----
const weighInShortcut = "Weigh_In_Arboleaf";
const syncShortcut = "Sync_Apple_WeightBF_Obsidian";

const weighInUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(weighInShortcut)}`;
const syncUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(syncShortcut)}`;

// ---- helpers ----
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) : "—";

const numFrom = (s) => {
  const m = (s ?? "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};

const lastN = (arr, n) => arr.slice(Math.max(0, arr.length - n));

const mean = (arr) =>
  arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN;

// sample standard deviation (n-1)
const stdev = (arr) => {
  if (!arr || arr.length < 2) return NaN;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
};

// green(120)->red(0)
const colorFromT = (t) => `hsl(${120 * (1 - clamp(t, 0, 1))}, 80%, 45%)`;

// 0σ -> green, 2σ+ -> red
const colorByZ = (value, target, sd) => {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(target) ||
    !Number.isFinite(sd) ||
    sd === 0
  ) {
    return "var(--text-normal)";
  }

  const z = Math.abs(value - target) / sd;
  const t = clamp(z / 2, 0, 1);
  return colorFromT(t);
};

// Strip YAML frontmatter from raw file content, so we only parse data lines
const stripFrontmatter = (text) => {
  if (typeof text !== "string") return "";

  const s = text.replace(/\r\n/g, "\n");

  if (!s.startsWith("---\n")) return s;

  const endIdx = s.indexOf("\n---\n", 4);

  if (endIdx === -1) return s;

  return s.slice(endIdx + "\n---\n".length);
};

// Update/insert Weight_Logged: true into YAML using split on "---\n"
const setWeightLoggedTrue = (fileText) => {
  let text = String(fileText ?? "").replace(/\r\n/g, "\n");
  const marker = "---\n";

  if (text.startsWith(marker)) {
    const parts = text.split(marker);

    // parts: ["", yaml, rest...]
    if (parts.length >= 3) {
      let yaml = parts[1] ?? "";
      const rest = parts.slice(2).join(marker);

      // Replace existing key or append it
      if (/^Weight_Logged\s*:/m.test(yaml)) {
        yaml = yaml.replace(/^Weight_Logged\s*:\s*.*$/m, "Weight_Logged: true");
      } else {
        if (yaml.length && !yaml.endsWith("\n")) yaml += "\n";
        yaml += "Weight_Logged: true\n";
      }

      return marker + yaml + marker + rest;
    }
  }

  // No YAML present -> add it
  return `---\nWeight_Logged: true\n---\n` + text;
};

// Resolve a file path robustly
const getFileByPath = (path) => {
  if (!path) return null;

  const direct = app.vault.getAbstractFileByPath(path);
  if (direct) return direct;

  const withMd = path.endsWith(".md") ? path : `${path}.md`;
  const directWithMd = app.vault.getAbstractFileByPath(withMd);
  if (directWithMd) return directWithMd;

  return null;
};

// ---- determine Weight_Logged state from the currently open note ----
const activeFile = app.workspace.getActiveFile();
let weightLogged = false;

if (activeFile) {
  const activePage =
    dv.page(activeFile.path) ||
    dv.page(activeFile.path.replace(/\.md$/i, ""));

  const wl = activePage?.Weight_Logged;

  weightLogged =
    wl === true ||
    String(wl ?? "").toLowerCase() === "true";
}

// ---- resolve Weight_Data.md ----
const weightDataFile = getFileByPath(weightDataPath);

if (!weightDataFile) {
  dv.paragraph(`Could not find weight data file at: ${weightDataPath}`);
  return;
}

// ---- load targets from YAML in Weight_Data.md ----
const page =
  dv.page(weightDataFile.path) ||
  dv.page(weightDataFile.path.replace(/\.md$/i, ""));

const targetWeight = numFrom(String(page?.Target_Weight ?? ""));
const targetBF = numFrom(String(page?.Target_BF ?? ""));

// ---- parse Weight_Data entries ----
let rawFull = "";

try {
  rawFull = await app.vault.read(weightDataFile);
} catch (err) {
  dv.paragraph(`Could not read weight data file at: ${weightDataFile.path}`);
  console.error("Weight dashboard: failed to read weight data file", err);
  return;
}

if (typeof rawFull !== "string" || !rawFull.trim()) {
  dv.paragraph(`Weight data file is empty or unreadable: ${weightDataFile.path}`);
  return;
}

const raw = stripFrontmatter(rawFull);

const lines = raw
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(Boolean);

const entries = lines
  .map(line => {
    line = line.replace(/^\-\s*/, "");

    const parts = line.split(" - ").map(p => p.trim());

    if (parts.length < 3) return null;

    const date = dv.date(parts[0]); // Luxon DateTime
    const weight = numFrom(parts[1]);
    const bf = numFrom(parts[2]);

    if (!date || !Number.isFinite(weight) || !Number.isFinite(bf)) return null;

    return {
      date,
      dateStr: date.toFormat("yyyy-MM-dd"),
      weight,
      bf
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.date.ts - b.date.ts);

if (!entries.length) {
  dv.paragraph("No parsable entries found.");
  return;
}

// ---- today detection ----
const todayStr = window.moment().format("YYYY-MM-DD");
const todays = entries.filter(e => e.dateStr === todayStr);
const hasToday = todays.length > 0;
const todayEntry = hasToday ? todays[todays.length - 1] : null;

// ---- windows/stats for display ----
const w7 = lastN(entries, 7);
const w28 = lastN(entries, 28);

const avgW7 = mean(w7.map(e => e.weight));
const avgBF7 = mean(w7.map(e => e.bf));

const sdW28 = stdev(w28.map(e => e.weight));
const sdBF28 = stdev(w28.map(e => e.bf));

// ---- emoji state ----
const stateEmoji = (!weightLogged) ? "⚖️" : (hasToday ? "⚖️" : "🔁");

// ---- display logic ----
const defaultBg = "var(--background-secondary)";
const redBg = "hsl(0, 70%, 35%)";

let bg = defaultBg;
let textColor = "var(--text-normal)";
let innerHtml = "";

if (!hasToday) {
  bg = redBg;
  textColor = "#fff";

  innerHtml = `
    <span style="opacity:0.95;">${stateEmoji}</span>
    <span style="font-weight:900;">${fmt(avgW7, 1)} kg</span>
    <span style="opacity:0.75;"> | </span>
    <span style="opacity:0.95;">🥧</span>
    <span style="font-weight:900;">${fmt(avgBF7, 1)}%</span>
  `;
} else {
  const wColor = colorByZ(todayEntry.weight, targetWeight, sdW28);
  const bfColor = colorByZ(todayEntry.bf, targetBF, sdBF28);

  innerHtml = `
    <span style="opacity:0.90;">${stateEmoji}</span>
    <span style="color:${wColor}; font-weight:900;">${fmt(todayEntry.weight, 1)} kg</span>
    <span style="opacity:0.70;"> | </span>
    <span style="opacity:0.90;">🥧</span>
    <span style="color:${bfColor}; font-weight:900;">${fmt(todayEntry.bf, 1)}%</span>
  `;
}

// ---- build button element and attach click handler ----
const buttonStyle = `
  display:inline-block;
  padding:6px 10px;
  border-radius:10px;
  border:1px solid var(--background-modifier-border);
  background:${bg};
  text-decoration:none;
  font-weight:600;
  color:${textColor};
  cursor:pointer;
`;

// wrapper that centers the button
const wrapper = dv.el("div", "", { cls: "weight-dashboard-wrap" });
wrapper.style.display = "flex";
wrapper.style.justifyContent = "center";
wrapper.style.width = "100%";

// existing container now lives inside the centered wrapper
const container = document.createElement("div");
container.className = "weight-dashboard";
container.innerHTML = `
  <a id="weightDashBtn" style="${buttonStyle}">
    ${innerHtml}
  </a>
`;

wrapper.appendChild(container);

const btn = container.querySelector("#weightDashBtn");

btn.addEventListener("click", async (evt) => {
  evt.preventDefault();
  evt.stopPropagation();

  const activeFile = app.workspace.getActiveFile();

  if (!activeFile) return;

  // Determine Weight_Logged from metadata if possible
  const activePage =
    dv.page(activeFile.path) ||
    dv.page(activeFile.path.replace(/\.md$/i, ""));

  const wl = activePage?.Weight_Logged;

  const hasLogged =
    wl === true ||
    String(wl ?? "").toLowerCase() === "true";

  // If missing/empty/falsey -> set to TRUE and open weigh-in shortcut
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

  // If logged true, but NO data today in Weight_Data -> run sync shortcut
  if (!hasToday) {
    window.location.href = syncUrl;
    return;
  }

  // If logged true AND we have today's data -> do nothing
});
```

```dataviewjs
// ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ START HABITS
const DEBUG = false;

const HABITS_FOLDER = "Z_Personal admin/Habits"; // no trailing slash
const IGNORE_TAG = "#dashboard";

const { Modal, Setting, Notice, TFile } = require("obsidian");

const COLOR_YESTERDAY = "#627ac7";
const COLOR_7DAYS = "#c76276";

// ---------- helpers ----------
function extractEmoji(filename) {
  const chars = Array.from((filename ?? "").trim());
  return chars.length ? chars[0] : "✅";
}

function formatLabel(emoji, details) {
  const d = (details ?? "").trim();
  return d.length ? `${emoji}, ${d}` : `${emoji}`;
}

function getFrequency(page) {
  const raw = page?.Frequency ?? page?.frequency;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 1;
}

// Dataview may return YAML dates as Luxon DateTime objects.
// This normalizes strings / Luxon / moment / Date => "YYYY-MM-DD" or null.
function normalizeYmd(v) {
  if (v == null) return null;

  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (window.moment) {
      const m = window.moment(s);
      if (m.isValid()) return m.format("YYYY-MM-DD");
    }
    return null;
  }

  if (typeof v === "object") {
    // Luxon DateTime (Dataview)
    if (typeof v.toISODate === "function") {
      const s = v.toISODate();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    }

    // moment (just in case)
    if (window.moment && window.moment.isMoment && window.moment.isMoment(v)) {
      return v.format("YYYY-MM-DD");
    }
  }

  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }

  return null;
}

// robust tag check across common DV shapes
function hasTag(page, tag) {
  const needle = (tag ?? "").replace(/^#/, "").toLowerCase();
  const tags = page?.file?.tags ?? page?.tags ?? [];
  if (Array.isArray(tags)) {
    return tags.some(t => String(t).replace(/^#/, "").toLowerCase() === needle);
  }
  if (typeof tags === "string") {
    return tags.split(/\s+/).some(t => String(t).replace(/^#/, "").toLowerCase() === needle);
  }
  return false;
}

// Determine the "date context" of the Daily Note you're viewing.
// Prefer current note filename if it's YYYY-MM-DD; fall back to today.
function getContextDate() {
  const cur = dv.current();
  const fromName = normalizeYmd(cur?.file?.name);
  if (fromName) return fromName;

  const fromFrontmatter =
    normalizeYmd(cur?.date) ||
    normalizeYmd(cur?.Date) ||
    normalizeYmd(cur?.day) ||
    normalizeYmd(cur?.Day);
  if (fromFrontmatter) return fromFrontmatter;

  return todayStr();
}

// --- parsing lines: date alone OR date - details ---
function parseEntries(text) {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .filter(l => l.length);

  const re = /^(\d{4}-\d{2}-\d{2})(?:\s*-\s*(.*))?$/;

  const entries = [];
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    entries.push({ date: m[1], details: (m[2] ?? "") });
  }
  return entries;
}

function latestEntry(text) {
  const entries = parseEntries(text);
  if (!entries.length) return null;
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return entries[entries.length - 1];
}

function formatLogLine(date, details) {
  const d = (details ?? "").trim();
  return d.length ? `${date} - ${d}` : `${date}`;
}

function upsertTodayLine(text, today, details) {
  const lines = (text ?? "").split(/\r?\n/);
  const re = /^(\d{4}-\d{2}-\d{2})(?:\s*-\s*(.*))?$/;

  let replaced = false;
  const out = lines.map(line => {
    const trimmed = line.trimEnd();
    const m = trimmed.match(re);
    if (!m) return line;
    if (m[1] !== today) return line;
    replaced = true;
    return formatLogLine(today, details);
  });

  if (!replaced) {
    const trimmedText = (text ?? "").replace(/\s+$/g, "");
    const newline = formatLogLine(today, details);
    if (!trimmedText) return `${newline}\n`;
    return `${trimmedText}\n${newline}\n`;
  }

  return out.join("\n").replace(/\s+$/g, "") + "\n";
}

// --- date helpers ---
function todayStr() {
  return window.moment ? window.moment().format("YYYY-MM-DD") : new Date().toISOString().slice(0, 10);
}

function diffDays(aYmd, bYmd) {
  // a - b in days
  if (window.moment) return window.moment(aYmd, "YYYY-MM-DD").diff(window.moment(bYmd, "YYYY-MM-DD"), "days");
  const a = new Date(aYmd + "T00:00:00Z");
  const b = new Date(bYmd + "T00:00:00Z");
  return Math.floor((a - b) / (24 * 60 * 60 * 1000));
}

function addDays(ymd, days) {
  if (window.moment) return window.moment(ymd, "YYYY-MM-DD").add(days, "days").format("YYYY-MM-DD");
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- color interpolation ---
function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  const to2 = (v) => v.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex({
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  });
}
// overdueDays: 0 => default, 1 => yesterday color, 7+ => 7-day color
function colorForOverdueDays(overdueDays) {
  if (overdueDays <= 0) return null;
  if (overdueDays >= 7) return COLOR_7DAYS;
  const t = (overdueDays - 1) / 6; // 1..7 => 0..1
  return lerpColor(COLOR_YESTERDAY, COLOR_7DAYS, t);
}

// --- Frontmatter updater: set or add a key in YAML frontmatter ---
function setFrontmatterField(fileText, key, valueYmdOrString) {
  const value = String(valueYmdOrString);

  if (!fileText.startsWith("---")) {
    return `---\n${key}: ${value}\n---\n\n${fileText}`;
  }
  const end = fileText.indexOf("\n---", 3);
  if (end === -1) {
    return `---\n${key}: ${value}\n---\n\n${fileText}`;
  }

  const fmBlock = fileText.slice(0, end + 4); // include "\n---"
  const rest = fileText.slice(end + 4);

  const reKey = new RegExp(`^\\s*${key}\\s*:\\s*.*$`, "m");
  const hasKey = reKey.test(fmBlock);
  let newFm;
  if (hasKey) {
    newFm = fmBlock.replace(reKey, `${key}: ${value}`);
  } else {
    newFm = fmBlock.replace(/\n---$/, `\n${key}: ${value}\n---`);
  }
  return newFm + rest;
}

// ---------- modal ----------
class HabitEntryModal extends Modal {
  constructor(app, title, onSave, onHideForToday) {
    super(app);
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
      .addText(text => {
        text.setPlaceholder("e.g. 80 (or leave blank)")
          .onChange(v => (this.value = v));
        setTimeout(() => text.inputEl.focus(), 0);
      });

    const actions = new Setting(contentEl);

    actions.addButton(btn =>
      btn.setButtonText("Save")
        .setCta()
        .onClick(() => {
          const v = (this.value ?? "").trimEnd(); // allow empty
          this.close();
          this.onSave(v);
        })
    );

    // "Postpone" now means: hide for this daily note only (no Next_Date change, no log line)
    actions.addButton(btn =>
      btn.setButtonText("Postpone")
        .onClick(() => {
          this.close();
          this.onHideForToday();
        })
    );

    actions.addExtraButton(btn =>
      btn.setIcon("cross")
        .setTooltip("Cancel")
        .onClick(() => this.close())
    );
  }
  onClose() { this.contentEl.empty(); }
}

// ---------- rendering ----------
function createCenteredRoot(opacity = 1) {
  const root = dv.el("div", "", { cls: "habit-tracker-inline" });
  root.style.display = "flex";
  root.style.flexWrap = "wrap";
  root.style.gap = "8px";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.margin = "0 auto";
  root.style.textAlign = "center";
  root.style.opacity = String(opacity);
  return root;
}

function styleButton(btn) {
  btn.style.display = "inline-flex";
  btn.style.alignItems = "center";
  btn.style.whiteSpace = "nowrap";
  btn.style.padding = "6px 10px";
  btn.style.borderRadius = "8px";
  btn.style.transition = "background-color 200ms ease, color 200ms ease, opacity 200ms ease";
}

async function renderHabitButtons({ pages, contextDate, opacity, dueDateForDisplay }) {
  // dueDateForDisplay lets us preview "tomorrow's habits" by evaluating due-ness for a different date
  const evalDate = dueDateForDisplay ?? contextDate;

  const root = createCenteredRoot(opacity);
  let rendered = 0;

  for (const p of pages) {
    const path = p.file.path;
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;

    const emoji = extractEmoji(p.file.name);
    const frequency = getFrequency(p);

    const nextDate = normalizeYmd(p?.Next_Date ?? p?.next_date ?? p?.NextDate);
    const hideDate = normalizeYmd(p?.Hide_Date ?? p?.hide_date ?? p?.HideDate ?? p?.Hide);

        // Hide-for-this-day rule:
    // If a habit was hidden for the Daily Note date (contextDate), it should not appear
    // anywhere in today's widget — including the "tomorrow" preview.
    // Also respect hiding for the evaluated date (e.g. if you ever hide tomorrow in advance).
    if (hideDate && (hideDate === contextDate || hideDate === evalDate)) continue;


    // Due rule (for whichever date we're evaluating)
    const overdueDays = nextDate ? diffDays(evalDate, nextDate) : 999; // missing => treat as very overdue
    const isDue = !nextDate || overdueDays >= 0;
    if (!isDue) continue;

    // (When showing tomorrow preview) we only want habits that are NOT already due today.
    // So in preview mode, exclude anything that is due at contextDate.
    if (dueDateForDisplay) {
      const overdueToday = nextDate ? diffDays(contextDate, nextDate) : 999;
      const isDueToday = !nextDate || overdueToday >= 0;
      const hiddenToday = normalizeYmd(p?.Hide_Date ?? p?.hide_date ?? p?.HideDate ?? p?.Hide) === contextDate;
      if (isDueToday && !hiddenToday) {
        // Already would have shown today, so don't duplicate in tomorrow-preview.
        continue;
      }
    }

    const bodyText = await dv.io.load(path);
    const latest = latestEntry(bodyText);

    const btn = root.createEl("button", {
      cls: "habit-btn",
      text: formatLabel(emoji, latest?.details),
    });
    styleButton(btn);

    const bg = colorForOverdueDays(overdueDays);
    if (bg) {
      btn.style.backgroundColor = bg;
      btn.style.color = "white";
    }

    btn.addEventListener("click", () => {
      new HabitEntryModal(
        app,
        p.file.name,

        // Save: set Next_Date = contextDate + Frequency AND write log line for contextDate
        async (entered) => {
          const d = contextDate; // critical: use the Daily Note date, not "now"
          const currentFull = await app.vault.read(file);

          const freq = Number.isFinite(Number(frequency)) ? Number(frequency) : 1;
          const newNext = addDays(d, Math.max(0, freq));

          let updatedFull = setFrontmatterField(currentFull, "Next_Date", newNext);
          updatedFull = upsertTodayLine(updatedFull, d, entered);

          // Optional hygiene: if Hide_Date == this day, clear it by setting to empty string.
          // (Leaving it is harmless, but this keeps frontmatter tidy.)
          const existingHide = normalizeYmd(p?.Hide_Date ?? p?.hide_date ?? p?.HideDate ?? p?.Hide);
          if (existingHide === d) {
            updatedFull = setFrontmatterField(updatedFull, "Hide_Date", "");
          }

          await app.vault.modify(file, updatedFull);

          btn.remove();
          new Notice(`Saved & scheduled next: ${newNext}`);
        },

        // Postpone: set Hide_Date = contextDate, do not change Next_Date, do not log
        async () => {
          const d = contextDate;
          const currentFull = await app.vault.read(file);
          const updatedFull = setFrontmatterField(currentFull, "Hide_Date", d);

          await app.vault.modify(file, updatedFull);

          btn.remove();
          new Notice("Hidden for today");
        }
      ).open();
    });

    rendered++;
  }

  return { root, rendered };
}

// ---------- main ----------
(async () => {
  const contextDate = getContextDate();
  const tomorrow = addDays(contextDate, 1);

  const pagesAll = dv.pages(`"${HABITS_FOLDER}"`)
    .where(p => p?.file?.path?.startsWith(HABITS_FOLDER + "/"))
    .sort(p => p.file.name, "asc");

  // Filter out dashboard-tagged notes
  const pages = pagesAll.where(p => !hasTag(p, IGNORE_TAG));

  // Debug output (centered)
  if (DEBUG) {
    const dbg = dv.el("div", "", { cls: "habit-debug" });
    dbg.style.textAlign = "center";
    dbg.createEl("h4", { text: `Habit tracker debug (context: ${contextDate})` });

    const ul = dbg.createEl("ul");
    ul.style.marginTop = "6px";
    ul.style.display = "inline-block";
    ul.style.textAlign = "left";

    for (const p of pages) {
      const path = p.file.path;
      const bodyText = await dv.io.load(path);
      const latest = latestEntry(bodyText);

      const frequency = getFrequency(p);
      const nextDate = normalizeYmd(p?.Next_Date ?? p?.next_date ?? p?.NextDate);
      const hideDate = normalizeYmd(p?.Hide_Date ?? p?.hide_date ?? p?.HideDate ?? p?.Hide);

      const mostRecent =
        latest
          ? `${latest.date}${(latest.details ?? "").trim() ? ` - ${latest.details.trim()}` : ""}`
          : "(none)";

      ul.createEl("li", {
        text: `${p.file.name} | Most recent: ${mostRecent} | Frequency: ${frequency} | Next_Date: ${nextDate ?? "(missing)"} | Hide_Date: ${hideDate ?? "(none)"}`
      });
    }
  }

  // Render today's due habits
  const todayResult = await renderHabitButtons({
    pages,
    contextDate,
    opacity: 1,
    dueDateForDisplay: null
  });

  if (todayResult.rendered > 0) return;

  // If none due today: show tomorrow's habits at 50% opacity
  const tomorrowResult = await renderHabitButtons({
    pages,
    contextDate,
    opacity: 0.5,
    dueDateForDisplay: tomorrow
  });

   // If even tomorrow has nothing, show a centered button that opens the Habits note
  if (tomorrowResult.rendered === 0) {
    const wrap = dv.el("div", "", { cls: "habit-empty" });
    wrap.style.textAlign = "center";

    const btn = wrap.createEl("button", { text: "Habits" });
    btn.style.opacity = "0.5";
    btn.style.padding = "6px 10px";
    btn.style.borderRadius = "8px";
    btn.style.cursor = "pointer";

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const targetPath = "Z_Personal admin/Habits/Habits.md";
      const f = app.vault.getAbstractFileByPath(targetPath);
      if (f instanceof TFile) {
        await app.workspace.getLeaf(true).openFile(f);
      } else {
        new Notice(`Could not find: ${targetPath}`);
      }
    });
  }



})();
// ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ END HABIT TRACKER



```

***

  

#### [[Quick Tasks|✅ Tasks]] (`$=dv.pages("!#NoTaskCount").file.tasks.where( task => !task.completed && (task.text.includes("📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>") || task.text.includes("📅 <%* tR += (moment(noteDate).add(-1, 'days')).format('YYYY-MM-DD') %>") )).length`)  

  

<hr style ="margin-top:-12px; margin-bottom:-12px">  

  

```tasks  
not done  
path regex does not match /Template/  
path regex does not match /Shopping/  
heading does not include shopping  
heading does not include prep  
heading does not include packing  
description regex does not match /Backburner|Packing/  
path regex does not match /Calisthenics/  
# group by filename  
(due before <%* tR += (moment(noteDate).add(1, 'days')).format('YYYY-MM-DD') %>) OR (no happens date)  

group by function \
	   const duedate = task.due.moment ;\
	   const priority = task.priorityNumber; \
	   const label = (order, name) => `%%${order}%% ${name}`; \
	   if (!duedate) return label(4, '🌤️ Day'); \
		if (duedate.isBefore(moment("<%* tR += noteDate%>"), 'day')) return label (0,'❌ Overdue');\
	   if (priority == 0) return label(1, '🌄 Early Morning'); \
	   if (priority == 1) return label(2, '☀️ Morning'); \
	   if (priority == 2) return label(3, '🌞 Before Lunch'); \
	   if (priority == 3) return label(4, '🌤️ Day'); \
	   if (priority == 4) return label(5, '🌆 After Work'); \
	   if (priority == 5) return label(6, '🌃 Before Bed'); \
	   return label(6, 'Errors');
no tags
hide task count
hide recurrence rule
hide edit button
hide priority
hide due date
short mode
limit 100
hide toolbar
```  

  

  

<hr style ="margin-top:12px; margin-bottom:-12px">

### [[Shopping List|🛒 Shopping]] // 📝 Prep

<hr style ="margin-top:-6px; margin-bottom:-12px">

```tasks
not done
path does not include Template
(heading includes Shopping) OR (heading includes Packing) OR (heading includes Prep)
(heading does not include <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY') %>) OR (heading includes <%* tR += noteDate %>)
(happens today) OR (no happens date)
tags does not include #backburner
group by heading
short mode
limit 30
hide toolbar
```

<hr style ="margin-top:12px; margin-bottom:-12px">

##### [[ <%* tR += (moment(noteDate).add(-1, 'days')).format('YYYY-MM-DD') %>|⬅️ Previous]] // [[<%* tR += "Diaries/" + (moment(noteDate).add(1, 'days')).format('YYYY-MM-DD') %>|Next ➡️]] // [[Ten Day Planner|Ten Day]] 🗓️
![[<%*
tR += moment(noteDate).add(0, 'days').format('YYYY') %>-W<%* tR += moment(noteDate).add(0, 'days').format('WW') %>#<%* tR += moment(noteDate).add(0, 'days').format('dddd D MMMM') %>]]
```gEvent 
type: schedule
date: <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
exclude: ["Games Releases"]
timespan: 1
```

<hr style ="margin-top:8px; margin-bottom:-12px">

### [[--- TODO ---/Projects|Projects]]

<hr style ="margin-top:-6px; margin-bottom:-12px">

<% tp.file.include("[[TEM_ProjectsDV]]") %>

### 🗓️ [[--- TODO ---#Scheduled|Tomorrow]]
<hr style ="margin-top:-6px; margin-bottom:-12px">

```tasks
not done
description regex does not match /Backburner/
path regex does not match /Calisthenics/path regex does not match /Calisthenics/
sort by start date
has due date
happens <%* tR += (moment(noteDate).add(1, 'days')).format('YYYY-MM-DD') %>
short mode
hide recurrence rule
hide priority
hide due date
limit 100
hide toolbar
```
<hr style ="margin-top:8px; margin-bottom:-8px">


#### [[Completed Today|✅ Completed Today]] (`$=dv.pages().file.tasks.where( task => task.completed &&  task.text.includes("✅ <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>")).length`)

<hr style ="margin-top:-8px; margin-bottom:-12px">

### Daily Tasks
<hr style ="margin-top:-8px; margin-bottom:12px">




- [ ] 📰 Check the [Headlines](https://www.bbc.co.uk/news/topics/cpml2v678pxt) 🔺  📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 🟪 Do [NYT Connections](https://www.nytimes.com/games/connections) 🔺  📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
<% tp.file.include("[[Templates/Formatting/TEM_News]]") %> 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
<% tp.file.include("[[Templates/Formatting/TEM_Puzzles]]") %> 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 🦉 [Duolingo](shortcuts://run-shortcut?name=Duolingo) day <%* tR += (moment(noteDate).add(0, 'days')).format('DDD') - (-1006) %> 🔺  📅  <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
<%* if (moment(noteDate).add(0, 'days').format('dddd') == "Saturday"){%>
- [ ] 📱 Authenticate Google Calendar Phone ⏫ 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 💻 Authenticate Google Calendar iPad ⏫ 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 🖥️ Authenticate Google Calendar PC ⏫ 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
<%*}%>
<% tp.file.include("[[Templates/TEM_BJJ_Tutorial]]") %>
<%* if (moment(noteDate).add(0, 'days').format('DD') == "01") {%>
<hr style ="margin-top:-8px; margin-bottom:12px">

### Monthly Tasks
<hr style ="margin-top:-8px; margin-bottom:12px">

- [ ] 💷 Sort [Natwest Money](https://docs.google.com/spreadsheets/d/1PbpTraswzvSl1ay-ArqvdUiseeIETg9u_74g235HgTE/edit?usp=sharing) 🔼 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 📈 Check Investments 🔼 📅 <%* tR += (moment(noteDate).add(7, 'days')).format('YYYY-MM-DD') }%>

***
***

> [!note] *[<%*
const NPC_NameStart_1 = app.metadataCache.getFirstLinkpathDest("Today I am","");
const Result_NPC_NameStart_1 = (await app.vault.read(NPC_NameStart_1)).split("\n");
na = Math.floor(Math.random()*Result_NPC_NameStart_1.length);

const NPC_NameMid_1 = app.metadataCache.getFirstLinkpathDest("Today I am","");
const Result_NPC_NameMid_1 = (await app.vault.read(NPC_NameMid_1)).split("\n");
nb = Math.floor(Math.random()*Result_NPC_NameMid_1.length);

const NPC_NameEnd_1 = app.metadataCache.getFirstLinkpathDest("Today I am","");
const Result_NPC_NameEnd_1 = (await app.vault.read(NPC_NameEnd_1)).split("\n");
nc = Math.floor(Math.random()*Result_NPC_NameEnd_1.length);

tR += "Today I am " + Result_NPC_NameStart_1[na] + ", " + Result_NPC_NameMid_1[nb] + " and " + Result_NPC_NameEnd_1[nc] + "."  %>](obsidian://open?vault=%F0%9F%94%90%20Diaries&file=Diaries)*

***

<%*
// WEATHER UPDATER TEST
await tp.file.include("[[Templates/Formatting/TEM_Weather.md]]") %>
