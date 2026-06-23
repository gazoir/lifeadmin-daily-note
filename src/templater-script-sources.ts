/** Bundled in main.js so mobile installs work without syncing templater/*.js from the plugin folder. */
export const EMBEDDED_TEMPLATER_SCRIPTS: Record<string, string> = {
  "bake_weather.js": `module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeWeather) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeWeather(tp);
};
`,
  "bake_hevy.js": `module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeHevy) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeHevy(tp);
};
`,
  "bake_weight.js": `module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeWeight) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeWeight(tp);
};
`,
  "bake_habits.js": `module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeHabits) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeHabits(tp);
};
`,
  "bake_weight_habits.js": `module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeWeightHabits) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeWeightHabits(tp);
};
`,
  "bake_dashboard_row.js": `module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeDashboardRow) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeDashboardRow(tp);
};
`,
  "bake_gcal.js": `module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeGcal) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeGcal(tp);
};
`,
  "bake_gb_online_daily.js": `module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeGbOnlineDaily) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeGbOnlineDaily(tp);
};
`,
  "bake_project_header.js": `module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeProjectHeader) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeProjectHeader(tp);
};
`,
  "note_date.js": `module.exports = (tp) => {
  const title = String(tp.file.title ?? "").trim();
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(title) ? title : tp.date.now("YYYY-MM-DD");
};
`,
};
