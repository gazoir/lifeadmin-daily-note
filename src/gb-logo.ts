import { App, TFile, type Plugin } from "obsidian";
import type { LifeAdminSettings } from "./settings";

const BUNDLED_LOGO = "assets/gb-logo.svg";

export function gbLogoVaultPath(settings: LifeAdminSettings): string {
  if (settings.gbLogoPath?.trim()) return settings.gbLogoPath.trim();
  const parts = settings.gbOnlineNotePath.split("/");
  parts.pop();
  return `${parts.join("/")}/gb-logo.svg`;
}

export function resolveGbLogoUrl(app: App, settings: LifeAdminSettings, pluginDir: string): string {
  const vaultPath = gbLogoVaultPath(settings);
  const file = app.vault.getAbstractFileByPath(vaultPath);
  if (file instanceof TFile) {
    return app.vault.adapter.getResourcePath(file.path);
  }
  return app.vault.adapter.getResourcePath(`${pluginDir}/${BUNDLED_LOGO}`);
}

export async function ensureGbLogoInVault(plugin: Plugin, settings: LifeAdminSettings): Promise<void> {
  const vaultPath = gbLogoVaultPath(settings);
  const adapter = plugin.app.vault.adapter;
  const bundledPath = `${plugin.manifest.dir}/${BUNDLED_LOGO}`;
  let svg: string;
  if (await adapter.exists(bundledPath)) {
    svg = await adapter.read(bundledPath);
  } else {
    throw new Error(`Bundled GB logo not found: ${bundledPath}`);
  }

  if (await adapter.exists(vaultPath)) {
    const existing = await adapter.read(vaultPath);
    if (existing === svg) return;
    const file = plugin.app.vault.getAbstractFileByPath(vaultPath);
    if (file instanceof TFile) {
      await plugin.app.vault.modify(file, svg);
    }
    return;
  }

  const parts = vaultPath.split("/");
  const name = parts.pop()!;
  const folder = parts.join("/");
  if (folder && !(await adapter.exists(folder))) {
    await plugin.app.vault.createFolder(folder);
  }
  await plugin.app.vault.create(vaultPath, svg);
}
