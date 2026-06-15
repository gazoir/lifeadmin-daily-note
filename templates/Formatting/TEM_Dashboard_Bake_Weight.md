<%*
const weightDataPath = "Z_Personal admin/Domestic God/🩺 Health/Weight_Data.md";
const noteDate = (tp.file.title ?? "").trim();

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) : "—";
const numFrom = (s) => {
  const m = String(s ?? "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};
const lastN = (arr, n) => arr.slice(Math.max(0, arr.length - n));
const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN;
const stdev = (arr) => {
  if (!arr || arr.length < 2) return NaN;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
};
const colorFromT = (t) => `hsl(${120 * (1 - clamp(t, 0, 1))}, 80%, 45%)`;
const colorByZ = (value, target, sd) => {
  if (!Number.isFinite(value) || !Number.isFinite(target) || !Number.isFinite(sd) || sd === 0) return "var(--text-normal)";
  return colorFromT(clamp(Math.abs(value - target) / sd / 2, 0, 1));
};
const stripFrontmatter = (text) => {
  const s = String(text ?? "").replace(/\r\n/g, "\n");
  if (!s.startsWith("---\n")) return s;
  const endIdx = s.indexOf("\n---\n", 4);
  return endIdx === -1 ? s : s.slice(endIdx + 5);
};

const getFile = (path) => app.vault.getAbstractFileByPath(path) || app.vault.getAbstractFileByPath(path + ".md");
const weightFile = getFile(weightDataPath);

let innerHtml = `<span style="opacity:0.7;">⚖️ no data</span>`;
let bg = "var(--background-secondary)";
let textColor = "var(--text-normal)";
let hasToday = false;
let weightLogged = false;

if (weightFile) {
  const rawFull = await app.vault.read(weightFile);
  const fmMatch = rawFull.match(/^---\n([\s\S]*?)\n---/);
  const yaml = fmMatch?.[1] ?? "";
  const targetWeight = numFrom((yaml.match(/^Target_Weight:\s*"?([^"\n]+)"?/m) ?? [])[1]);
  const targetBF = numFrom((yaml.match(/^Target_BF:\s*"?([^"\n]+)"?/m) ?? [])[1]);

  const entries = stripFrontmatter(rawFull).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .map(line => {
      line = line.replace(/^\-\s*/, "");
      const parts = line.split(" - ").map(p => p.trim());
      if (parts.length < 3) return null;
      const weight = numFrom(parts[1]);
      const bf = numFrom(parts[2]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) || !Number.isFinite(weight) || !Number.isFinite(bf)) return null;
      return { dateStr: parts[0], weight, bf };
    })
    .filter(Boolean)
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  const todayStr = noteDate.match(/^\d{4}-\d{2}-\d{2}$/) ? noteDate : tp.date.now("YYYY-MM-DD");
  const todays = entries.filter(e => e.dateStr === todayStr);
  hasToday = todays.length > 0;
  const todayEntry = hasToday ? todays[todays.length - 1] : null;

  const w7 = lastN(entries, 7);
  const w28 = lastN(entries, 28);
  const avgW7 = mean(w7.map(e => e.weight));
  const avgBF7 = mean(w7.map(e => e.bf));
  const sdW28 = stdev(w28.map(e => e.weight));
  const sdBF28 = stdev(w28.map(e => e.bf));

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

tR += `<!-- dashboard:weight:start -->\n<div class="dashboard-widget dashboard-weight" data-widget="weight" data-has-today="${hasToday}" data-weight-logged="${weightLogged}" style="display:flex;justify-content:center;width:100%;">\n  <button type="button" class="dashboard-weight-btn" data-action="weight-click" style="display:inline-block;padding:6px 10px;border-radius:10px;border:1px solid var(--background-modifier-border);background:${bg};font-weight:600;color:${textColor};cursor:pointer;">${innerHtml}</button>\n  <button type="button" class="dashboard-action" data-action="refresh" data-widget="weight" title="Refresh weight" style="margin-left:6px;cursor:pointer;">↻</button>\n</div>\n<!-- dashboard:weight:end -->`;
%>
