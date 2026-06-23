import { Notice, TFile, type App } from "obsidian";
import { resolveTaskForSave, type ExtendedTask } from "./tasks-resolve";

/** Mirror Tasks 🔗 backlink: open the task's source file at its line. */
export async function openTaskSourceLink(app: App, button: HTMLElement): Promise<void> {
  const listItem = button.closest("li.plugin-tasks-list-item");
  const nativeLink = listItem?.querySelector<HTMLElement>(".tasks-backlink a.internal-link");
  if (nativeLink) {
    nativeLink.click();
    return;
  }

  const task = resolveTaskForSave(app, button);
  if (!task) {
    new Notice("LifeAdmin: could not resolve task to open.");
    return;
  }

  await openTaskAtLocation(app, task);
}

async function openTaskAtLocation(app: App, task: ExtendedTask): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.taskLocation.path);
  if (!(file instanceof TFile)) {
    new Notice(`LifeAdmin: file not found: ${task.taskLocation.path}`);
    return;
  }

  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, { eState: { line: task.taskLocation.lineNumber } });
}
