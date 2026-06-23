import { Notice } from "obsidian";

export function debugProject(enabled: boolean, step: string, detail?: Record<string, unknown>): void {
  if (!enabled) return;
  const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
  const line = `[LifeAdmin] ${step}${suffix}`;
  console.log(line, detail ?? "");
  new Notice(line, 6000);
}
