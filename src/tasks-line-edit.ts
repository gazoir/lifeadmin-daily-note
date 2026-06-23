export type HappensField = "dueDate" | "scheduledDate" | "startDate";

export interface MomentLike {
  isValid(): boolean;
  clone(): MomentLike;
  format(fmt: string): string;
  add(amount: number, unit: string): MomentLike;
  isSame?(other: MomentLike, unit?: string): boolean;
}

export interface TasksTaskLike {
  taskLocation: { path: string; lineNumber: number };
  dueDate?: MomentLike | null;
  scheduledDate?: MomentLike | null;
  startDate?: MomentLike | null;
}

/** Match Tasks postpone order: due → scheduled → start. */
export function getDateFieldToPostpone(task: TasksTaskLike): HappensField | null {
  if (task.dueDate?.isValid?.()) return "dueDate";
  if (task.scheduledDate?.isValid?.()) return "scheduledDate";
  if (task.startDate?.isValid?.()) return "startDate";
  return null;
}

export function getCurrentHappensMoment(task: TasksTaskLike, field: HappensField): MomentLike | null {
  const value = task[field];
  return value?.isValid?.() ? value.clone() : null;
}

export function formatDateString(moment: MomentLike): string {
  return moment.format("YYYY-MM-DD");
}

/** Tasks priorityNumber 0–5 → emoji (matches daily note group-by buckets). */
export const TIMING_PRIORITY_SLOTS: ReadonlyArray<{ label: string; symbol: string; priorityNumber: number }> = [
  { label: "🌄 Early Morning", symbol: "🔺", priorityNumber: 0 },
  { label: "☀️ Morning", symbol: "⏫", priorityNumber: 1 },
  { label: "🌞 Before Lunch", symbol: "🔼", priorityNumber: 2 },
  { label: "🌤️ Day", symbol: "", priorityNumber: 3 },
  { label: "🌆 After Work", symbol: "🔽", priorityNumber: 4 },
  { label: "🌃 Before Bed", symbol: "⏬", priorityNumber: 5 },
];
