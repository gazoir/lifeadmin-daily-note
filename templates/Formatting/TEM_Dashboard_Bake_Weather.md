<%*
const { requestUrl } = app;
const noteDate = (tp.file.title ?? "").trim();
const file = app.vault.getAbstractFileByPath(tp.file.path(true));

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};
const rgbToHex = ({ r, g, b }) => "#" + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, "0")).join("");
const tempToColor = (t) => {
  const CYAN = "#00ffff", BLUE = "#0000ff", YELL = "#ffff00", RED = "#ff0000";
  if (t <= -1) return CYAN;
  if (t >= 40) return RED;
  const mix = (a, b, tt) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex({ r: lerp(A.r, B.r, tt), g: lerp(A.g, B.g, tt), b: lerp(A.b, B.b, tt) });
  };
  if (t <= 10) return mix(CYAN, BLUE, clamp01((t + 1) / 11));
  if (t <= 30) return mix(BLUE, YELL, clamp01((t - 10) / 20));
  return mix(YELL, RED, clamp01((t - 30) / 10));
};
const iconEmoji = (icon, rain) => {
  const map = {
    "clear-day": "☀️", "clear-night": "🌙", "partly-cloudy-day": "🌤️", "partly-cloudy-night": "🌙☁️",
    "cloudy": "☁️", "rain": "🌧️", "showers-day": "🌦️", "showers-night": "🌧️",
    "thunder-rain": "⛈️", "thunder-showers-day": "⛈️", "thunder-showers-night": "⛈️",
    "snow": "🌨️", "sleet": "🌨️", "fog": "🌫️", "wind": "💨"
  };
  if (icon && map[icon]) return map[icon];
  if (Number.isFinite(rain)) {
    if (rain >= 60) return "🌧️";
    if (rain >= 30) return "🌦️";
    return "☀️";
  }
  return "🌤️";
};

let hi = null, lo = null, rain = null, precipMm = null, windKph = null, icon = "", status = "error";

try {
  const url = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/London%2C%20UK?unitGroup=metric&include=days&key=3FYLLKVYVJB96XZJLWFYPBN6V&contentType=json";
  const res = await requestUrl({ url });
  const d = res.json?.days?.[0];
  hi = Number.isFinite(d?.tempmax) ? Math.ceil(d.tempmax) : null;
  lo = Number.isFinite(d?.tempmin) ? Math.floor(d.tempmin) : null;
  rain = Number.isFinite(d?.precipprob) ? Math.floor(d.precipprob) : null;
  icon = d?.icon ?? "unknown";
  precipMm = Number.isFinite(d?.precip) ? Number(d.precip.toFixed(1)) : null;
  windKph = Number.isFinite(d?.windspeed) ? Math.round(d.windspeed) : null;
  status = (hi !== null && lo !== null) ? "ok" : "error";

  if (file) {
    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.highTemp = hi ?? "Error";
      fm.lowTemp = lo ?? "Error";
      fm.rainChance = rain !== null ? `${rain}%` : "Error";
      fm.icon = icon;
      fm.precipMm = precipMm ?? "—";
      fm.windKph = windKph ?? "—";
      fm.weatherStatus = status;
      fm.weatherUpdated = new Date().toISOString();
    });
  }
} catch (e) {
  if (file) {
    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.weatherStatus = "error";
      fm.weatherUpdated = new Date().toISOString();
    });
  }
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
  inner = parts.map(s => `<span style="margin-right:0.7em;">${s}</span>`).join("");
} else {
  inner = `<button type="button" class="dashboard-action" data-action="refresh" data-widget="weather">↻ Update weather</button>`;
}

tR += `<!-- dashboard:weather:start -->\n<div class="dashboard-widget dashboard-weather" data-widget="weather" style="text-align:center;white-space:nowrap;">\n  <span class="dashboard-weather-display">${inner}</span>\n  ${status === "ok" ? '<button type="button" class="dashboard-action" data-action="refresh" data-widget="weather" title="Refresh weather" style="margin-left:0.5em;cursor:pointer;">↻</button>' : ""}\n</div>\n<!-- dashboard:weather:end -->`;
%>
