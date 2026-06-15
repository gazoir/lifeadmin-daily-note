<%*
const filePath = tp.file.path(true);

setTimeout(async () => {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!file) return;

  try {
    const url = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/London%2C%20UK?unitGroup=metric&include=days&key=3FYLLKVYVJB96XZJLWFYPBN6V&contentType=json";
    const res = await tp.obsidian.requestUrl(url);
    const d = res.json?.days?.[0];

    const hi = d?.tempmax;
    const lo = d?.tempmin;
    const rain = d?.precipprob;
    const cond = d?.conditions;
    const icon = d?.icon;
    const precip = d?.precip;
    const wind = d?.windspeed;

    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.highTemp = Number.isFinite(hi) ? Math.ceil(hi) : "Error";
      fm.lowTemp = Number.isFinite(lo) ? Math.floor(lo) : "Error";
      fm.rainChance = Number.isFinite(rain) ? Math.floor(rain) + "%" : "Error";
      fm.conditions = cond ?? "Unknown";
      fm.icon = icon ?? "unknown";
      fm.precipMm = Number.isFinite(precip) ? Number(precip.toFixed(1)) : "—";
      fm.windKph = Number.isFinite(wind) ? Math.round(wind) : "—";
      fm.weatherStatus = "ok";
      fm.weatherUpdated = new Date().toISOString();
    });

  } catch (e) {
    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.weatherStatus = "error";
      fm.weatherUpdated = new Date().toISOString();
    });
  }
}, 1200);

tR += "";
%>
