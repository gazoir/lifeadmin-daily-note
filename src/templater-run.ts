import type { App, TFile } from "obsidian";

type TemplaterPluginLike = {
  templater?: {
    overwrite_file_commands: (file: TFile, activeOnly?: boolean) => Promise<void>;
    write_template_to_file: (template: TFile, file: TFile) => Promise<void>;
  };
};

function getTemplater(app: App): TemplaterPluginLike {
  const plugin = app.plugins.plugins["templater-obsidian"] as TemplaterPluginLike | undefined;
  if (!plugin?.templater) {
    throw new Error("Templater is required. Enable the Templater plugin.");
  }
  return plugin;
}

export async function writeTemplateToFile(app: App, template: TFile, file: TFile): Promise<void> {
  const plugin = getTemplater(app);
  if (!plugin.templater?.write_template_to_file) {
    throw new Error("Templater write_template_to_file is unavailable. Update Templater.");
  }
  await plugin.templater.write_template_to_file(template, file);
}

export async function runTemplaterOnFile(app: App, file: TFile): Promise<void> {
  const plugin = getTemplater(app);
  if (!plugin.templater?.overwrite_file_commands) {
    throw new Error("Templater overwrite_file_commands is unavailable. Update Templater.");
  }
  await new Promise((resolve) => window.setTimeout(resolve, 100));
  await plugin.templater.overwrite_file_commands(file, false);
}
