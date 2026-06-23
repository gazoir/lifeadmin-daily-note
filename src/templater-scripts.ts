import { Notice, type App, type Plugin } from "obsidian";
import { EMBEDDED_TEMPLATER_SCRIPTS } from "./templater-script-sources";

export const TEMPLATER_SCRIPT_NAMES = [
  "bake_weather.js",
  "bake_hevy.js",
  "bake_weight.js",
  "bake_habits.js",
  "bake_weight_habits.js",
  "bake_dashboard_row.js",
  "bake_gcal.js",
  "bake_gb_online_daily.js",
  "bake_project_header.js",
  "note_date.js",
] as const;

export type TemplaterScriptName = (typeof TEMPLATER_SCRIPT_NAMES)[number];

export const RECOMMENDED_TEMPLATER_SCRIPTS_FOLDER = "Templates/Templater User Scripts";

export function getTemplaterScriptsFolder(app: App): string {
  const tp = app.plugins.plugins["templater-obsidian"] as { settings?: { user_scripts_folder?: string } } | undefined;
  const folder = tp?.settings?.user_scripts_folder?.trim();
  return folder || RECOMMENDED_TEMPLATER_SCRIPTS_FOLDER;
}

export async function templaterScriptsMissing(app: App, folder = getTemplaterScriptsFolder(app)): Promise<boolean> {
  const adapter = app.vault.adapter;
  for (const name of TEMPLATER_SCRIPT_NAMES) {
    if (!(await adapter.exists(`${folder}/${name}`))) return true;
  }
  return false;
}

async function scriptContent(plugin: Plugin, name: TemplaterScriptName): Promise<string> {
  const embedded = EMBEDDED_TEMPLATER_SCRIPTS[name];
  if (embedded) return embedded;

  const source = `${plugin.manifest.dir}/templater/${name}`;
  const adapter = plugin.app.vault.adapter;
  if (await adapter.exists(source)) {
    return adapter.read(source);
  }

  throw new Error(`No bundled Templater script source for ${name}`);
}

export async function installTemplaterScripts(
  plugin: Plugin,
  folder = getTemplaterScriptsFolder(plugin.app),
): Promise<string[]> {
  const adapter = plugin.app.vault.adapter;
  const installed: string[] = [];

  if (!(await adapter.exists(folder))) {
    await adapter.mkdir(folder);
  }

  for (const name of TEMPLATER_SCRIPT_NAMES) {
    const content = await scriptContent(plugin, name);
    const dest = `${folder}/${name}`;
    await adapter.write(dest, content);
    installed.push(dest);
  }

  return installed;
}

export async function ensureTemplaterScripts(plugin: Plugin, quiet = false): Promise<boolean> {
  const folder = getTemplaterScriptsFolder(plugin.app);
  if (!(await templaterScriptsMissing(plugin.app, folder))) return false;
  await installTemplaterScripts(plugin, folder);
  if (!quiet) {
    new Notice(`LifeAdmin: installed Templater scripts in ${folder}`);
  }
  return true;
}

export function scheduleEnsureTemplaterScripts(plugin: Plugin): void {
  const attempt = (quiet: boolean) => {
    ensureTemplaterScripts(plugin, quiet).catch((e) => {
      console.warn("LifeAdmin: Templater script install failed:", e);
    });
  };

  plugin.app.workspace.onLayoutReady(() => {
    attempt(true);
    window.setTimeout(() => attempt(true), 2500);
    window.setTimeout(() => attempt(true), 8000);
  });
}
