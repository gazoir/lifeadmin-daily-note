import { Menu, Notice, TFile, type App, type Plugin } from "obsidian";
import type { LifeAdminSettings } from "./settings";
import { TIMING_PRIORITY_SLOTS, type TasksTaskLike } from "./tasks-line-edit";
import { resolveTaskForSave, resolveTaskFromButton, resolveTaskFromListItem, stampTaskOnButton } from "./tasks-resolve";
import { openTaskSourceLink } from "./tasks-open-link";
import {
  saveTaskFixedDateFromToday,
  saveTaskPriority,
  saveTaskRelativeDate,
  type SaveableTask,
} from "./tasks-save";
import {
  activeFileWantsGlobalLightningHide,
  isInsideHideLightningEmbed,
  syncHideLightningClasses,
} from "./tasks-query-layout";
import { configureQuickMenuDebug, qmLog } from "./tasks-quick-menu-debug";

type MenuItemWithSubmenu = {
  setTitle(title: string): MenuItemWithSubmenu;
  setIcon(icon: string): MenuItemWithSubmenu;
  onClick(callback: () => void): MenuItemWithSubmenu;
  setSubmenu(): Menu;
};

interface TasksApiV1 {
  editTaskLineModal(taskLine: string): Promise<string>;
}

interface TasksPluginLike {
  getTasks?: () => TasksTaskLike[];
  apiV1?: TasksApiV1;
}

const BODY_CLASS = "lifeadmin-quick-task-menu-enabled";
const INJECTED_ATTR = "data-lifeadmin-quick-menu";
const BUTTON_CLASS = "lifeadmin-task-quick-menu";
const RETRY_MS = [400, 1200];
const TASKS_VIEW_SELECTOR = ".markdown-preview-view, .markdown-source-view";
const tasksObserverRoots = new Set<HTMLElement>();

function attachTasksMutationObservers(observer: MutationObserver): void {
  document.querySelectorAll<HTMLElement>(TASKS_VIEW_SELECTOR).forEach((root) => {
    if (tasksObserverRoots.has(root)) return;
    tasksObserverRoots.add(root);
    observer.observe(root, { childList: true, subtree: true });
  });
}
let suppressScanUntil = 0;

export function suppressQuickMenuRescan(durationMs: number): void {
  suppressScanUntil = Date.now() + durationMs;
}

export function syncTasksQuickMenuBodyClass(enabled: boolean): void {
  document.body.classList.toggle(BODY_CLASS, enabled);
}

export function updateTasksQuickMenu(app: App, getSettings: () => LifeAdminSettings): void {
  const enabled = getSettings().tasksQuickMenuEnabled;
  syncTasksQuickMenuBodyClass(enabled);
  document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`li.plugin-tasks-list-item[${INJECTED_ATTR}]`).forEach((el) => {
    el.removeAttribute(INJECTED_ATTR);
  });
  if (enabled) {
    scanAndInjectButtons(app, getSettings);
    scheduleInjectionRetries(app, getSettings);
  }
}

function scheduleInjectionRetries(app: App, getSettings: () => LifeAdminSettings): void {
  for (const ms of RETRY_MS) {
    window.setTimeout(() => scanAndInjectButtons(app, getSettings), ms);
  }
}

export function registerTasksQuickMenu(
  plugin: Plugin,
  getSettings: () => LifeAdminSettings,
): () => void {
  configureQuickMenuDebug(() => getSettings().tasksQuickMenuDebug);

  let scanTimer: number | null = null;

  const scan = (): void => {
    if (!getSettings().tasksQuickMenuEnabled) return;
    scanAndInjectButtons(plugin.app, getSettings);
  };

  const scheduleScan = (): void => {
    if (Date.now() < suppressScanUntil) return;
    if (scanTimer !== null) window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      scan();
    }, 50);
  };

  const observer = new MutationObserver(scheduleScan);
  attachTasksMutationObservers(observer);

  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => {
      attachTasksMutationObservers(observer);
      scan();
      if (getSettings().tasksQuickMenuEnabled) scheduleInjectionRetries(plugin.app, getSettings);
    }),
  );

  syncTasksQuickMenuBodyClass(getSettings().tasksQuickMenuEnabled);
  if (getSettings().tasksQuickMenuEnabled) {
    scanAndInjectButtons(plugin.app, getSettings);
    scheduleInjectionRetries(plugin.app, getSettings);
  }

  return () => {
    if (scanTimer !== null) window.clearTimeout(scanTimer);
    observer.disconnect();
    tasksObserverRoots.clear();
    document.body.classList.remove(BODY_CLASS);
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((el) => el.remove());
    document.querySelectorAll(`li.plugin-tasks-list-item[${INJECTED_ATTR}]`).forEach((el) => {
      el.removeAttribute(INJECTED_ATTR);
    });
  };
}

function scanAndInjectButtons(app: App, getSettings: () => LifeAdminSettings): void {
  void syncHideLightningClasses(app).then(async () => {
    if (await activeFileWantsGlobalLightningHide(app)) {
      document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((el) => el.remove());
      document.querySelectorAll(`li.plugin-tasks-list-item[${INJECTED_ATTR}]`).forEach((el) => {
        el.removeAttribute(INJECTED_ATTR);
      });
      return;
    }
    document.querySelectorAll("li.plugin-tasks-list-item").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (isInsideHideLightningEmbed(el)) return;
      injectQuickMenuButton(app, el, getSettings);
    });
  });
}

function wireQuickMenuButton(
  app: App,
  button: HTMLElement,
  getSettings: () => LifeAdminSettings,
): void {
  let pressTimer: number | null = null;
  let longPressTriggered = false;

  const clearPressTimer = (): void => {
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  button.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    clearPressTimer();
    longPressTriggered = false;
    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      longPressTriggered = true;
      void openTaskEditModal(app, button);
    }, getSettings().tasksQuickMenuLongPressMs);
  });

  button.addEventListener("mouseup", () => {
    clearPressTimer();
  });

  button.addEventListener("mouseleave", () => {
    clearPressTimer();
  });

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }
    const task = resolveTaskFromButton(app, button);
    if (!task) {
      new Notice("LifeAdmin: could not resolve task for quick menu.");
      return;
    }
    stampTaskOnButton(button, task);
    showQuickTaskMenu(app, getSettings(), button, event);
  });

  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearPressTimer();
    longPressTriggered = false;
    void openTaskEditModal(app, button);
  });
}

function injectQuickMenuButton(app: App, listItem: HTMLElement, getSettings: () => LifeAdminSettings): void {
  if (isInsideHideLightningEmbed(listItem)) return;
  if (listItem.hasAttribute(INJECTED_ATTR)) return;

  let extras = listItem.querySelector<HTMLElement>(".task-extras");
  if (!extras) {
    extras = document.createElement("span");
    extras.classList.add("task-extras");
    listItem.appendChild(extras);
  }

  if (extras.querySelector(`.${BUTTON_CLASS}`)) {
    const existingButton = extras.querySelector<HTMLElement>(`.${BUTTON_CLASS}`);
    if (existingButton) {
      const task = resolveTaskFromListItem(app, listItem);
      if (task) stampTaskOnButton(existingButton, task);
    }
    listItem.setAttribute(INJECTED_ATTR, "1");
    return;
  }

  const button = document.createElement("a");
  button.classList.add(BUTTON_CLASS);
  button.textContent = "⚡";
  button.href = "#";
  button.title = "Quick task menu (hold or right-click for full edit)";

  const task = resolveTaskFromListItem(app, listItem);
  if (task) stampTaskOnButton(button, task);

  wireQuickMenuButton(app, button, getSettings);

  extras.appendChild(button);
  listItem.setAttribute(INJECTED_ATTR, "1");
}

function getTasksPlugin(app: App): TasksPluginLike | null {
  const plugin = app.plugins.plugins["obsidian-tasks-plugin"] as TasksPluginLike | undefined;
  return plugin?.getTasks ? plugin : null;
}

async function openTaskEditModal(app: App, button: HTMLElement): Promise<void> {
  const task = resolveTaskFromButton(app, button);
  if (!task) {
    new Notice("LifeAdmin: could not resolve task for edit.");
    return;
  }
  stampTaskOnButton(button, task);

  const file = app.vault.getAbstractFileByPath(task.taskLocation.path);
  if (!(file instanceof TFile)) {
    new Notice(`LifeAdmin: task file not found: ${task.taskLocation.path}`);
    return;
  }

  const lines = (await app.vault.read(file)).split("\n");
  const currentLine = lines[task.taskLocation.lineNumber];
  if (currentLine === undefined) {
    new Notice("LifeAdmin: task line not found in file.");
    return;
  }

  const api = getTasksPlugin(app)?.apiV1;
  if (!api?.editTaskLineModal) {
    new Notice("LifeAdmin: Tasks edit API unavailable.");
    return;
  }

  const edited = await api.editTaskLineModal(currentLine);
  if (!edited || edited === currentLine) return;

  lines[task.taskLocation.lineNumber] = edited;
  await app.vault.modify(file, lines.join("\n"));
}

function showQuickTaskMenu(
  app: App,
  _settings: LifeAdminSettings,
  button: HTMLElement,
  event: MouseEvent,
): void {
  const menu = new Menu();

  menu.addItem((item) =>
    item.setTitle("Due today").onClick(() => {
      void runQuickMenuSave(app, button, (task) => saveTaskFixedDateFromToday(app, task, 0, "day"));
    }),
  );

  menu.addItem((item) =>
    item.setTitle("Due tomorrow").onClick(() => {
      void runQuickMenuSave(app, button, (task) => saveTaskFixedDateFromToday(app, task, 1, "day"));
    }),
  );

  menu.addItem((item) => {
    item.setTitle("Postpone");
    const submenu = (item as unknown as MenuItemWithSubmenu).setSubmenu();

    const dayOptions = [
      { label: "Postpone by 1 day", amount: 1, unit: "day" as const },
      { label: "Postpone by 2 days", amount: 2, unit: "day" as const },
      { label: "Postpone by 3 days", amount: 3, unit: "day" as const },
      { label: "Postpone by 4 days", amount: 4, unit: "day" as const },
      { label: "Postpone by 5 days", amount: 5, unit: "day" as const },
      { label: "Postpone by 6 days", amount: 6, unit: "day" as const },
    ];
    for (const option of dayOptions) {
      submenu.addItem((subItem) =>
        subItem.setTitle(option.label).onClick(() => {
          void runQuickMenuSave(app, button, (task) =>
            saveTaskRelativeDate(app, task, option.amount, option.unit),
          );
        }),
      );
    }

    submenu.addSeparator();

    const longerOptions = [
      { label: "Postpone by a week", amount: 1, unit: "week" as const },
      { label: "Postpone by 2 weeks", amount: 2, unit: "week" as const },
      { label: "Postpone by 3 weeks", amount: 3, unit: "week" as const },
      { label: "Postpone by a month", amount: 1, unit: "month" as const },
    ];
    for (const option of longerOptions) {
      submenu.addItem((subItem) =>
        subItem.setTitle(option.label).onClick(() => {
          void runQuickMenuSave(app, button, (task) =>
            saveTaskRelativeDate(app, task, option.amount, option.unit),
          );
        }),
      );
    }
  });

  menu.addItem((item) => {
    item.setTitle("Timing");
    const submenu = (item as unknown as MenuItemWithSubmenu).setSubmenu();
    for (const slot of TIMING_PRIORITY_SLOTS) {
      submenu.addItem((subItem) =>
        subItem.setTitle(slot.label).onClick(() => {
          void runQuickMenuSave(app, button, (task) => saveTaskPriority(app, task, slot.priorityNumber));
        }),
      );
    }
  });

  menu.addSeparator();

  menu.addItem((item) =>
    item.setTitle("Open link").setIcon("link").onClick(() => {
      void openTaskSourceLink(app, button);
    }),
  );

  menu.showAtMouseEvent(event);
}

async function runQuickMenuSave(
  app: App,
  button: HTMLElement,
  save: (task: TasksTaskLike) => Promise<SaveableTask | null>,
): Promise<void> {
  qmLog("runQuickMenuSave start");
  const task = resolveTaskForSave(app, button);
  if (!task) {
    new Notice("LifeAdmin: could not resolve task for quick menu.");
    return;
  }
  stampTaskOnButton(button, task);

  suppressQuickMenuRescan(1200);
  const updatedTask = await save(task);
  qmLog("runQuickMenuSave finished", { saved: !!updatedTask });
  if (updatedTask) {
    stampTaskOnButton(button, updatedTask);
  }
}
