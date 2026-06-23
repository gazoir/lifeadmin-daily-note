import { Platform, type App } from "obsidian";

export interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  recurrence?: string[];
  recurringEventId?: string;
  parent?: { id?: string; colorId?: string };
}

export interface GCalGetEventsParams {
  startDate: unknown;
  endDate: unknown;
  include?: string[];
  exclude?: string[];
}

export interface GoogleCalendarApi {
  getEvents: (params: GCalGetEventsParams) => Promise<GCalEvent[]>;
  getEvent: (id: string, calendarId?: string) => Promise<GCalEvent>;
  openEventModal?: (event: GCalEvent, onClose?: () => void) => void;
}

export const GCAL_EVENT_DETAILS_VIEW = "google-calendar-view-event_details";

export interface GoogleCalendarPluginInstance {
  api?: GoogleCalendarApi;
  settings?: { googleRefreshToken?: string };
  settingsTab?: { display: () => void };
  initView?: (viewType: string, event: GCalEvent, onClose: () => void) => Promise<unknown>;
}

const SIX_MONTHS_DAYS = 183;

/** Google Calendar event colors (matches google-calendar plugin `pf`). */
const GCAL_EVENT_COLORS: Record<string, string> = {
  "1": "#a4bdfc",
  "2": "#7ae7bf",
  "3": "#dbadff",
  "4": "#ff887c",
  "5": "#fbd75b",
  "6": "#ffb878",
  "7": "#46d6db",
  "8": "#e1e1e1",
  "9": "#5484ed",
  "10": "#51b749",
  "11": "#dc2127",
};

/** Google Calendar list colors (matches google-calendar plugin `f1`). */
const GCAL_CALENDAR_COLORS: Record<string, string> = {
  "1": "#ac725e",
  "2": "#d06b64",
  "3": "#f83a22",
  "4": "#fa573c",
  "5": "#ff7537",
  "6": "#ffad46",
  "7": "#42d692",
  "8": "#16a765",
  "9": "#7bd148",
  "10": "#b3dc6c",
  "11": "#fbe983",
  "12": "#fad165",
  "13": "#92e1c0",
  "14": "#9fe1e7",
  "15": "#9fc6e7",
  "16": "#4986e7",
  "17": "#9a9cff",
  "18": "#b99aff",
  "19": "#c2c2c2",
  "20": "#cabdbf",
  "21": "#cca6ac",
  "22": "#f691b2",
  "23": "#cd74e6",
  "24": "#a47ae2",
};

const DEFAULT_GCAL_COLOR = "#a4bdfc";

export function eventCalendarColor(event: GCalEvent): string {
  if (event.colorId && GCAL_EVENT_COLORS[event.colorId]) return GCAL_EVENT_COLORS[event.colorId];
  const calColorId = event.parent?.colorId;
  if (calColorId && GCAL_CALENDAR_COLORS[calColorId]) return GCAL_CALENDAR_COLORS[calColorId];
  return DEFAULT_GCAL_COLOR;
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function momentFn(): ((inp?: unknown) => { startOf: (u: string) => unknown; add: (n: number, u: string) => unknown; isBefore: (o: unknown) => boolean; format: (f: string) => string; toISOString: () => string }) | null {
  const m = (window as unknown as { moment?: unknown }).moment;
  return typeof m === "function" ? (m as ReturnType<typeof momentFn>) : null;
}

export function getGoogleCalendarPlugin(app: App): GoogleCalendarPluginInstance | null {
  const plugin = app.plugins.plugins["google-calendar"];
  return plugin ? (plugin as GoogleCalendarPluginInstance) : null;
}

export function getGoogleCalendarApi(app: App): GoogleCalendarApi | null {
  return getGoogleCalendarPlugin(app)?.api ?? null;
}

export function isGoogleCalendarAuthenticated(app: App): boolean {
  if (!getGoogleCalendarPlugin(app)) return false;
  const fromStorage = window.localStorage.getItem("googleCalendarRefreshToken");
  if (fromStorage?.trim()) return true;
  const settingsToken = getGoogleCalendarPlugin(app)?.settings?.googleRefreshToken;
  return Boolean(settingsToken?.trim());
}

export function isGoogleCalendarAuthError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  if (/not logged in/i.test(msg)) return true;
  const status = (error as { status?: number }).status;
  if (status === 401) return true;
  return /invalid_grant|token has been expired|authentication|oauth/i.test(msg);
}

export function openGoogleCalendarAuthSettings(app: App): void {
  const plugin = getGoogleCalendarPlugin(app);
  if (!plugin?.settingsTab?.display) {
    throw new Error("Google Calendar plugin not loaded.");
  }
  plugin.settingsTab.display();
}

export async function openGoogleCalendarEventEditor(
  app: App,
  eventId: string,
  calendarId: string,
  onClose?: () => void,
  fallback?: { dateYmd: string; exclude?: string[] },
): Promise<void> {
  const plugin = getGoogleCalendarPlugin(app);
  if (!plugin) throw new Error("Google Calendar plugin not loaded.");

  if (!isGoogleCalendarAuthenticated(app)) {
    openGoogleCalendarAuthSettings(app);
    return;
  }

  const api = getGoogleCalendarApi(app);
  if (!api?.getEvent) throw new Error("Google Calendar API unavailable.");

  let event: GCalEvent | undefined;
  try {
    event = await api.getEvent(eventId, calendarId || undefined);
  } catch (e) {
    if (isGoogleCalendarAuthError(e)) {
      openGoogleCalendarAuthSettings(app);
      return;
    }
    if (fallback?.dateYmd) {
      const dayEvents = await fetchCalendarEventsForDay(app, fallback.dateYmd, fallback.exclude ?? []);
      event = dayEvents.find((item) => item.id === eventId);
    }
    if (!event) throw e;
  }

  const openModal = api.openEventModal;
  if (typeof openModal === "function") {
    openModal.call(api, event, onClose ?? (() => {}));
    return;
  }

  if (Platform.isMobile) {
    throw new Error("Google Calendar plugin needs openEventModal for mobile event editing.");
  }

  const initView = plugin.initView;
  if (typeof initView !== "function") {
    throw new Error("Google Calendar plugin cannot open event editor.");
  }

  await initView.call(plugin, GCAL_EVENT_DETAILS_VIEW, event, onClose ?? (() => {}));
}

export function eventStartIso(event: GCalEvent): string {
  const start = event.start as { date?: unknown; dateTime?: unknown } | undefined;
  if (!start) return "";
  const raw = start.dateTime ?? start.date;
  if (raw == null || raw === "") return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const m = raw as { toISOString?: () => string; format?: (f: string) => string };
    if (typeof m.toISOString === "function") return m.toISOString();
    if (typeof m.format === "function") return m.format();
  }
  return String(raw);
}

export function eventTitle(event: GCalEvent): string {
  const e = event as GCalEvent & { title?: string };
  return String(e.summary ?? e.title ?? "").trim();
}

export function eventStartMs(event: GCalEvent): number {
  const iso = eventStartIso(event);
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function parseRruleIntervalDays(rruleLine: string): number | null {
  const rule = rruleLine.replace(/^RRULE:/i, "").trim();
  const freq = (/FREQ=([A-Z]+)/i.exec(rule)?.[1] ?? "").toUpperCase();
  if (!freq) return null;
  const interval = Math.max(1, Number(/INTERVAL=(\d+)/i.exec(rule)?.[1] ?? 1));
  switch (freq) {
    case "DAILY":
      return interval;
    case "WEEKLY":
      return interval * 7;
    case "MONTHLY":
      return interval * 30;
    case "YEARLY":
      return interval * 365;
    default:
      return null;
  }
}

export function recurrenceIntervalDays(event: GCalEvent, byId: Map<string, GCalEvent>): number | null {
  const rules = event.recurrence ?? (event.recurringEventId ? byId.get(event.recurringEventId)?.recurrence : undefined);
  if (!rules?.length) return null;
  let min: number | null = null;
  for (const line of rules) {
    const days = parseRruleIntervalDays(line);
    if (days === null) continue;
    min = min === null ? days : Math.min(min, days);
  }
  return min;
}

export function isOneOffEvent(event: GCalEvent): boolean {
  return !event.recurringEventId && !(event.recurrence?.length);
}

export function passesRecurrenceFilter(event: GCalEvent, byId: Map<string, GCalEvent>): boolean {
  if (isOneOffEvent(event)) return true;

  const interval = recurrenceIntervalDays(event, byId);
  if (interval === null) return false;
  return interval >= SIX_MONTHS_DAYS;
}

export function seriesKey(event: GCalEvent): string {
  return event.recurringEventId || event.id;
}

/** All ids that should suppress an event in the project inbox after hide or create. */
export function eventIgnoreKeys(event: GCalEvent): string[] {
  const keys = new Set<string>();
  if (event.id) keys.add(event.id);
  if (event.recurringEventId) keys.add(event.recurringEventId);
  return [...keys];
}

export function isEventIgnored(event: GCalEvent, hidden: Set<string>): boolean {
  for (const key of eventIgnoreKeys(event)) {
    if (hidden.has(key)) return true;
  }
  return hidden.has(seriesKey(event));
}

export async function fetchUpcomingCalendarEvents(app: App, daysAhead: number): Promise<GCalEvent[]> {
  const api = getGoogleCalendarApi(app);
  if (!api?.getEvents) throw new Error("Google Calendar plugin not loaded. Enable it in Community plugins.");

  const moment = momentFn();
  if (!moment) throw new Error("moment.js is not available (required by Google Calendar plugin).");

  const events = await api.getEvents({
    startDate: moment().startOf("day"),
    endDate: moment().add(daysAhead, "days"),
    include: [],
    exclude: [],
  });

  return Array.isArray(events) ? events : [];
}

export function eventOccursOnDay(event: GCalEvent, dateYmd: string): boolean {
  const moment = momentFn();
  const start = event.start;
  if (!start) return false;

  if (start.date && !start.dateTime) {
    const startDay = String(start.date).slice(0, 10);
    const endDay = String(event.end?.date ?? "").slice(0, 10);
    if (startDay === dateYmd) return true;
    if (endDay && dateYmd >= startDay && dateYmd < endDay) return true;
    return false;
  }

  const raw = start.dateTime ?? start.date;
  if (raw == null || raw === "") return false;

  let localDay = "";
  if (typeof raw === "object" && raw !== null) {
    const m = raw as { format?: (f: string) => string };
    if (typeof m.format === "function") localDay = m.format("YYYY-MM-DD");
  }
  if (!localDay && moment) {
    localDay = (moment(String(raw)) as { format: (f: string) => string }).format("YYYY-MM-DD");
  }
  if (!localDay) {
    const iso = eventStartIso(event);
    localDay = iso.slice(0, 10);
  }
  return localDay === dateYmd;
}

export function formatEventTime(event: GCalEvent): string {
  if (event.start?.date && !event.start?.dateTime) return "All day";
  const moment = momentFn();
  const iso = eventStartIso(event);
  if (!moment || !iso) return "";
  const m = moment(iso) as { format: (f: string) => string };
  return m.format("HH:mm");
}

export async function fetchCalendarEventsForDay(
  app: App,
  dateYmd: string,
  exclude: string[] = [],
): Promise<GCalEvent[]> {
  const api = getGoogleCalendarApi(app);
  if (!api?.getEvents) throw new Error("Google Calendar plugin not loaded. Enable it in Community plugins.");

  const moment = momentFn();
  if (!moment) throw new Error("moment.js is not available (required by Google Calendar plugin).");

  const events = await api.getEvents({
    startDate: moment(dateYmd).startOf("day"),
    endDate: moment(dateYmd).endOf("day"),
    include: [],
    exclude,
  });

  const list = Array.isArray(events) ? events : [];
  return list.filter((e) => eventOccursOnDay(e, dateYmd)).sort((a, b) => eventStartMs(a) - eventStartMs(b));
}

export function collectLinkedGcalIds(app: App): Set<string> {
  const ids = new Set<string>();
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;
    for (const key of ["event-id", "gcal-event-id", "gcal-recurring-event-id", "recurringEventId"]) {
      const v = fm[key];
      if (v != null && String(v).trim()) ids.add(String(v).trim());
    }
  }
  return ids;
}

export function isEventAlreadyLinked(event: GCalEvent, linkedIds: Set<string>): boolean {
  if (linkedIds.has(event.id)) return true;
  if (event.recurringEventId && linkedIds.has(event.recurringEventId)) return true;
  return false;
}

export function filterProjectCandidateEvents(
  events: GCalEvent[],
  linkedIds: Set<string>,
  hiddenSeries: Set<string> = new Set(),
  nowMs = Date.now(),
): GCalEvent[] {
  const moment = momentFn();
  const dayStartMs = moment ? (moment().startOf("day") as { valueOf: () => number }).valueOf() : nowMs;
  const byId = new Map(events.map((e) => [e.id, e]));
  const upcoming = events.filter((e) => eventStartMs(e) >= dayStartMs);
  const bySeries = new Map<string, GCalEvent>();

  for (const event of upcoming) {
    if (!eventTitle(event)) continue;
    if (!eventStartIso(event)) continue;
    if (!passesRecurrenceFilter(event, byId)) continue;
    if (isEventAlreadyLinked(event, linkedIds)) continue;
    if (isEventIgnored(event, hiddenSeries)) continue;
    const key = seriesKey(event);
    const prev = bySeries.get(key);
    if (!prev || eventStartMs(event) < eventStartMs(prev)) {
      bySeries.set(key, event);
    }
  }

  return Array.from(bySeries.values()).sort((a, b) => eventStartMs(a) - eventStartMs(b));
}

export function formatEventWhen(event: GCalEvent): string {
  const moment = momentFn();
  const iso = eventStartIso(event);
  if (!moment || !iso) return iso || "Unknown date";
  const m = moment(iso) as { isValid?: () => boolean; format: (f: string) => string };
  if (typeof m.isValid === "function" && !m.isValid()) return iso;
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
  return isAllDay ? m.format("ddd D MMM YYYY") : m.format("ddd D MMM YYYY, HH:mm");
}
