export interface LifeAdminSettings {
  hevyLogPath: string;
  weightDataPath: string;
  habitsFolder: string;
  habitsIndexPath: string;
  hevyApiKey: string;
  weatherApiKey: string;
  weatherLocation: string;
  weighInShortcut: string;
  syncShortcut: string;
  weatherShortcut: string;
  habitIgnoreTag: string;
  projectTemplatePath: string;
  dailyTemplatePath: string;
  projectCreateFolder: string;
  projectIgnoredPath: string;
  projectGcalLookAheadDays: number;
  /** @deprecated Migrated to projectIgnoredPath on load */
  projectGcalHiddenSeries: string[];
  gcalExcludeCalendars: string[];
  debugProjectButton: boolean;
  /** Replaces Tasks ⏩ with ⚡ quick menu globally when enabled. */
  tasksQuickMenuEnabled: boolean;
  /** Hold duration (ms) before opening full Tasks edit modal. */
  tasksQuickMenuLongPressMs: number;
  /** Log ⚡ resolve/save steps to the console and show failure Notices. */
  tasksQuickMenuDebug: boolean;
  shoppingListPath: string;
  gbOnlineNotePath: string;
  gbOnlineDataPath: string;
  /** Vault path for the Gracie Barra header logo (SVG). */
  gbLogoPath: string;
  /** GB1 master-catalog links for mobile deep linking (permalink → cid). */
  gb1CurriculumPath: string;
  weeklyNotesFolder: string;
}

export const DEFAULT_SETTINGS: LifeAdminSettings = {
  hevyLogPath: "Z_Personal admin/Exercise/Workouts/Hevy Log.md",
  weightDataPath: "Z_Personal admin/Domestic God/🩺 Health/Weight_Data.md",
  habitsFolder: "Z_Personal admin/Habits",
  habitsIndexPath: "Z_Personal admin/Habits/Habits.md",
  hevyApiKey: "",
  weatherApiKey: "",
  weatherLocation: "London, UK",
  weighInShortcut: "Weigh_In_Arboleaf",
  syncShortcut: "Sync_Apple_WeightBF_Obsidian",
  weatherShortcut: "Weather",
  habitIgnoreTag: "dashboard",
  projectTemplatePath: "Templates/Formatting/TEM_Project.md",
  dailyTemplatePath: "Templates/Formatting/TEM_Daily Note.md",
  projectCreateFolder: "Z_Personal admin",
  projectIgnoredPath: "Z_Personal admin/Projects/Ignored.md",
  projectGcalLookAheadDays: 365,
  projectGcalHiddenSeries: [],
  gcalExcludeCalendars: ["Games Releases"],
  debugProjectButton: true,
  tasksQuickMenuEnabled: true,
  tasksQuickMenuLongPressMs: 500,
  tasksQuickMenuDebug: false,
  shoppingListPath: "Z_Personal admin/Domestic God/Shopping List.md",
  gbOnlineNotePath: "Z_Personal admin/Domestic God/🩺 Health/🥋 BJJ/GB Online.md",
  gbOnlineDataPath: "Z_Personal admin/Domestic God/🩺 Health/🥋 BJJ/GB Online Data.md",
  gbLogoPath: "Z_Personal admin/Domestic God/🩺 Health/🥋 BJJ/gb-logo.svg",
  gb1CurriculumPath: "Z_Personal admin/Domestic God/🩺 Health/🥋 BJJ/BJJ Curriculum.md",
  weeklyNotesFolder: "Diaries/Weekly",
};
