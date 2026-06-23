// Deprecated: Templater names user functions by filename, not export keys.
// Use bake_weather.js, bake_hevy.js, bake_weight.js, bake_habits.js instead.
// If kept, call as: tp.user.lifeadmin.bake_weather(tp)
module.exports = {
  bake_weather: (tp) => app.plugins.plugins["lifeadmin-daily-note"].api.bakeWeather(tp),
  bake_hevy: (tp) => app.plugins.plugins["lifeadmin-daily-note"].api.bakeHevy(tp),
  bake_weight: (tp) => app.plugins.plugins["lifeadmin-daily-note"].api.bakeWeight(tp),
  bake_habits: (tp) => app.plugins.plugins["lifeadmin-daily-note"].api.bakeHabits(tp),
};
