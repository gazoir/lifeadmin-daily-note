module.exports = async (tp) => {
  const plugin = app.plugins.plugins["lifeadmin-daily-note"];
  if (!plugin?.api?.bakeProjectHeader) {
    throw new Error("LifeAdmin Daily Note plugin not loaded. Enable it in Community plugins.");
  }
  return await plugin.api.bakeProjectHeader(tp);
};
