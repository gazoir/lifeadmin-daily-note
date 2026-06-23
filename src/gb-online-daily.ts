import type { App, TFile } from "obsidian";
import { DAILY_NOTE_PATH_RE } from "./daily-notes";
import type { LifeAdminSettings } from "./settings";
import type { GbDailySeriesLayout, GbDailyWeekLayout, GbVideo, GbWeekContext } from "./gb-online-data";
import { isGbVideoPlayable, readGbOnlineData, syncGbWeekCatalog, updateGbOnlineData } from "./gb-online-data";
import { formatYmd } from "./utils";

export type { GbDailyQueueOrigin, GbDailySeriesLayout, GbDailyWeekLayout } from "./gb-online-data";

export const QUEUE_SERIES_ID = "queue";
export const QUEUE_SERIES_LABEL = "Queue";
export const GBF_SERIES_LABEL = "GBF";

export interface GbDailyProgress {
  done: number;
  total: number;
  pct: number;
  featured: GbVideo | null;
}

export function seriesIdFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isGbfVideo(video: GbVideo): boolean {
  return /^GBF\b/i.test(video.title.trim());
}

export function deriveSeriesLabel(video: GbVideo): string {
  if (isGbfVideo(video)) return GBF_SERIES_LABEL;
  if (video.track === "gb1") {
    if (/tip of the week/i.test(video.title)) return "GB1 · Tips";
    return "GB1";
  }
  if (video.track === "gb2") {
    const paren = video.title.match(/\(GB2 by [^)]+\)/i);
    if (paren) return paren[0].slice(1, -1);
    const inline = video.title.match(/GB2 by .+?(?=\s*$)/i);
    if (inline) return inline[0].trim();
    if (/tip of the week/i.test(video.title)) return "GB2 · Tips";
    if (video.section && /GB2 by/i.test(video.section)) return video.section.replace(/^Tips And Drills - /i, "");
    return "GB2";
  }
  return video.section || "Other";
}

export function dailyTrackVideos(videos: GbVideo[]): GbVideo[] {
  return videos.filter((v) => v.track === "gb1" || v.track === "gb2");
}

function cloneLayout(layout: GbDailyWeekLayout): GbDailyWeekLayout {
  return {
    series: layout.series.map((s) => ({ ...s, cids: [...s.cids] })),
    queueOrigins: layout.queueOrigins ? { ...layout.queueOrigins } : undefined,
  };
}

function queueSeries(): GbDailySeriesLayout {
  return { id: QUEUE_SERIES_ID, label: QUEUE_SERIES_LABEL, cids: [] };
}

function sortSeriesForDefault(series: GbDailySeriesLayout[]): GbDailySeriesLayout[] {
  const queue = series.find((s) => s.id === QUEUE_SERIES_ID) ?? queueSeries();
  const rest = series.filter((s) => s.id !== QUEUE_SERIES_ID);
  const gbf = rest.filter((s) => s.id === seriesIdFromLabel(GBF_SERIES_LABEL));
  const nonGbf = rest.filter((s) => s.id !== seriesIdFromLabel(GBF_SERIES_LABEL));
  return [queue, ...nonGbf, ...gbf];
}

export function buildDefaultDailyLayout(videos: GbVideo[]): GbDailyWeekLayout {
  const byId = new Map<string, GbDailySeriesLayout>();

  for (const video of dailyTrackVideos(videos)) {
    const label = deriveSeriesLabel(video);
    const id = seriesIdFromLabel(label);
    let group = byId.get(id);
    if (!group) {
      group = { id, label, cids: [] };
      byId.set(id, group);
    }
    if (!group.cids.includes(video.cid)) group.cids.push(video.cid);
  }

  return { series: sortSeriesForDefault([queueSeries(), ...byId.values()]) };
}

/** Migrate saved layouts: ensure Queue, split GBF from GB1, pin GBF last. */
export function normalizeDailyLayout(layout: GbDailyWeekLayout, videos: GbVideo[]): GbDailyWeekLayout {
  const videoByCid = new Map(dailyTrackVideos(videos).map((v) => [v.cid, v]));
  const next = cloneLayout(layout);
  let queue = next.series.find((s) => s.id === QUEUE_SERIES_ID);
  if (!queue) {
    queue = queueSeries();
    next.series.unshift(queue);
  }

  const queued = new Set(queue.cids);
  next.queueOrigins = next.queueOrigins ?? {};

  let gbf = next.series.find((s) => s.id === seriesIdFromLabel(GBF_SERIES_LABEL));
  if (!gbf) {
    gbf = { id: seriesIdFromLabel(GBF_SERIES_LABEL), label: GBF_SERIES_LABEL, cids: [] };
    next.series.push(gbf);
  }

  for (const group of next.series) {
    if (group.id === QUEUE_SERIES_ID || group.id === gbf.id) continue;
    const move: string[] = [];
    group.cids = group.cids.filter((cid) => {
      const video = videoByCid.get(cid);
      if (!video || queued.has(cid)) return Boolean(video) && !queued.has(cid);
      if (isGbfVideo(video)) {
        move.push(cid);
        return false;
      }
      return true;
    });
    for (const cid of move) {
      if (!gbf.cids.includes(cid)) gbf.cids.push(cid);
    }
  }

  for (const cid of [...queue.cids]) {
    if (!videoByCid.has(cid)) {
      queue.cids = queue.cids.filter((x) => x !== cid);
      delete next.queueOrigins[cid];
    }
  }

  ensureSeriesShellsForQueueOrigins(next);
  const originSeriesIds = seriesIdsWithQueueOrigins(next);
  next.series = sortSeriesForDefault(
    next.series.filter(
      (s) => s.id === QUEUE_SERIES_ID || s.cids.length || s.id === gbf.id || originSeriesIds.has(s.id),
    ),
  );
  if (!next.series.some((s) => s.id === gbf.id)) next.series.push(gbf);
  return next;
}

export function mergeDailyLayout(existing: GbDailyWeekLayout, videos: GbVideo[]): GbDailyWeekLayout {
  const normalized = normalizeDailyLayout(existing, videos);
  const trackVideos = dailyTrackVideos(videos);
  const validCids = new Set(trackVideos.map((v) => v.cid));
  const byLabel = new Map<string, string[]>();
  for (const video of trackVideos) {
    const label = deriveSeriesLabel(video);
    const list = byLabel.get(label) ?? [];
    if (!list.includes(video.cid)) list.push(video.cid);
    byLabel.set(label, list);
  }

  const queued = new Set(normalized.series.find((s) => s.id === QUEUE_SERIES_ID)?.cids ?? []);
  const merged = cloneLayout(normalized);
  const seenIds = new Set<string>();

  for (const group of merged.series) {
    if (group.id === QUEUE_SERIES_ID) {
      group.cids = group.cids.filter((cid) => validCids.has(cid));
      seenIds.add(group.id);
      continue;
    }
    const kept = group.cids.filter((cid) => validCids.has(cid) && !queued.has(cid));
    for (const cid of byLabel.get(group.label) ?? []) {
      if (!kept.includes(cid) && !queued.has(cid)) kept.push(cid);
    }
    if (group.id === seriesIdFromLabel(GBF_SERIES_LABEL) || kept.length) {
      group.cids = kept;
      seenIds.add(group.id);
    }
  }

  merged.series = merged.series.filter(
    (s) => s.id === QUEUE_SERIES_ID || s.cids.length || seriesIdsWithQueueOrigins(merged).has(s.id),
  );

  for (const video of trackVideos) {
    const label = deriveSeriesLabel(video);
    const id = seriesIdFromLabel(label);
    if (seenIds.has(id) || queued.has(video.cid)) continue;
    merged.series.push({ id, label, cids: [...(byLabel.get(label) ?? [video.cid])] });
    seenIds.add(id);
  }

  if (!merged.series.length) return buildDefaultDailyLayout(videos);
  return { ...merged, series: sortSeriesForDefault(merged.series) };
}

export function sortCidsByPlayability(cids: string[], videoByCid: Map<string, GbVideo>): string[] {
  const playable: string[] = [];
  const unplayable: string[] = [];
  for (const cid of cids) {
    if (isGbVideoPlayable(videoByCid.get(cid))) playable.push(cid);
    else unplayable.push(cid);
  }
  return [...playable, ...unplayable];
}

export function isSeriesPlayable(cids: string[], videoByCid: Map<string, GbVideo>): boolean {
  return cids.some((cid) => isGbVideoPlayable(videoByCid.get(cid)));
}

/** Queue first; playable series before all-unplayable series; unplayable cids last within each series. */
export function sortSeriesForPlayabilityDisplay(
  series: GbDailySeriesLayout[],
  videoByCid: Map<string, GbVideo>,
): GbDailySeriesLayout[] {
  const queue = series.find((s) => s.id === QUEUE_SERIES_ID);
  const rest = series.filter((s) => s.id !== QUEUE_SERIES_ID);
  const playableRest: GbDailySeriesLayout[] = [];
  const unplayableRest: GbDailySeriesLayout[] = [];
  for (const s of rest) {
    const sorted = { ...s, cids: sortCidsByPlayability(s.cids, videoByCid) };
    if (isSeriesPlayable(sorted.cids, videoByCid)) playableRest.push(sorted);
    else unplayableRest.push(sorted);
  }
  const ordered = [...playableRest, ...unplayableRest];
  return queue ? [queue, ...ordered] : ordered;
}

export function flattenDailyLayout(layout: GbDailyWeekLayout): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of layout.series) {
    for (const cid of group.cids) {
      if (seen.has(cid)) continue;
      seen.add(cid);
      out.push(cid);
    }
  }
  return out;
}

export function flattenDailyLayoutForProgress(
  layout: GbDailyWeekLayout,
  videoByCid: Map<string, GbVideo>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of sortSeriesForPlayabilityDisplay(layout.series, videoByCid)) {
    for (const cid of group.cids) {
      if (seen.has(cid)) continue;
      seen.add(cid);
      out.push(cid);
    }
  }
  return out;
}

export function ensureDailyLayout(
  saved: GbDailyWeekLayout | undefined,
  videos: GbVideo[],
): GbDailyWeekLayout {
  if (!saved?.series?.length) return buildDefaultDailyLayout(videos);
  return mergeDailyLayout(saved, videos);
}

export function computeDailyProgress(
  videos: GbVideo[],
  layout: GbDailyWeekLayout,
  watched: Record<string, string>,
): GbDailyProgress {
  const byCid = new Map(videos.map((v) => [v.cid, v]));
  const order = flattenDailyLayoutForProgress(layout, byCid).filter((cid) => byCid.has(cid));
  const total = order.length;
  const done = order.filter((cid) => watched[cid]).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const nextPlayable = order.find((cid) => !watched[cid] && isGbVideoPlayable(byCid.get(cid)));
  const nextCid = nextPlayable ?? order.find((cid) => !watched[cid]);
  const featured = nextCid ? (byCid.get(nextCid) ?? null) : null;
  return { done, total, pct, featured };
}

export interface GbDailyBakeSnapshot {
  done: number;
  total: number;
  featuredCid: string | null;
  synced: boolean;
}

export function gbDailyBakeSnapshotFromProgress(progress: GbDailyProgress, synced: boolean): GbDailyBakeSnapshot {
  return {
    done: progress.done,
    total: progress.total,
    featuredCid: progress.featured?.cid ?? null,
    synced,
  };
}

export function parseGbDailyCountFromHtml(html: string): { done: number; total: number } | null {
  if (html.includes("dashboard-gb-daily-sync-prompt")) return null;
  const m = html.match(/dashboard-gb-daily-section-count[^>]*>([^<]+)/);
  if (!m) return null;
  const label = m[1]!.trim();
  if (/not synced/i.test(label)) return null;
  const parts = label.match(/(\d+)\s*\/\s*(\d+)/);
  if (!parts) return null;
  return { done: Number(parts[1]), total: Number(parts[2]) };
}

export function parseGbDailyFeaturedCidFromHtml(html: string): string | null {
  const m = html.match(/data-action="gb-daily-featured"[^>]*data-cid="(\d+)"/);
  return m?.[1] ?? null;
}

export function isGbDailyBakedHtmlStale(html: string, expected: GbDailyBakeSnapshot): boolean {
  if (!expected.synced) return false;
  if (html.includes("dashboard-gb-daily-sync-prompt") || /Not synced/i.test(html)) return true;
  const parsed = parseGbDailyCountFromHtml(html);
  if (!parsed || parsed.done !== expected.done || parsed.total !== expected.total) return true;
  const featured = parseGbDailyFeaturedCidFromHtml(html);
  return (featured ?? null) !== (expected.featuredCid ?? null);
}

function layoutKey(weekNum: number): string {
  return String(weekNum);
}

export function readDailyPlaylistOpen(store: Awaited<ReturnType<typeof readGbOnlineData>>, weekNum: number): boolean {
  return store.dailyUi?.[layoutKey(weekNum)]?.playlistOpen === true;
}

export function readDailyWidgetExpanded(
  store: Awaited<ReturnType<typeof readGbOnlineData>>,
  weekNum: number,
): boolean {
  return store.dailyUi?.[layoutKey(weekNum)]?.widgetExpanded === true;
}

export function readDailyOpenSeries(
  store: Awaited<ReturnType<typeof readGbOnlineData>>,
  weekNum: number,
): string[] {
  return store.dailyUi?.[layoutKey(weekNum)]?.openSeriesIds ?? [];
}

function mergeDailyWeekUi(
  store: Awaited<ReturnType<typeof readGbOnlineData>>,
  weekNum: number,
  patch: { playlistOpen?: boolean; widgetExpanded?: boolean; openSeriesIds?: string[] },
): void {
  const key = layoutKey(weekNum);
  const prev = store.dailyUi?.[key] ?? {};
  store.dailyUi = { ...(store.dailyUi ?? {}), [key]: { ...prev, ...patch } };
}

export async function setDailyPlaylistOpen(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  open: boolean,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    mergeDailyWeekUi(store, weekNum, { playlistOpen: open });
  });
}

export async function setDailyWidgetExpanded(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  expanded: boolean,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    mergeDailyWeekUi(store, weekNum, { widgetExpanded: expanded });
  });
}

export async function setDailyOpenSeries(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  openSeriesIds: string[],
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    mergeDailyWeekUi(store, weekNum, { openSeriesIds: [...openSeriesIds] });
  });
}

export function readDailyOpenSeriesFromDom(app: App, file: TFile, weekNum: number): string[] {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view as { file?: TFile };
    if (view.file?.path !== file.path) continue;
    const root = leaf.containerEl.querySelector<HTMLElement>(`.dashboard-gb-daily[data-week="${weekNum}"]`);
    if (!root) continue;
    return Array.from(root.querySelectorAll<HTMLDetailsElement>(".dashboard-gb-daily-series-details[open]"))
      .map((el) => el.closest<HTMLElement>(".dashboard-gb-daily-series")?.dataset.seriesId?.trim() ?? "")
      .filter(Boolean);
  }
  return [];
}

export function isGbDailyWidgetExpanded(root: HTMLElement): boolean {
  if (root instanceof HTMLDetailsElement) return root.open;
  return root.classList.contains("is-expanded");
}

export function applyGbDailyWidgetExpanded(root: HTMLElement, expanded: boolean): void {
  if (root instanceof HTMLDetailsElement) {
    root.open = expanded;
    return;
  }
  root.classList.toggle("is-expanded", expanded);
}

export function restoreGbDailyWidgetExpandedFromSession(root: HTMLElement, sourcePath: string): void {
  if (!DAILY_NOTE_PATH_RE.test(sourcePath)) return;
  if (readSessionDailyWidgetExpanded(sourcePath) === true) applyGbDailyWidgetExpanded(root, true);
}

export function readDailyWidgetExpandedFromDom(app: App, file: TFile, weekNum?: number): boolean | null {
  const attr =
    weekNum !== undefined && Number.isFinite(weekNum) && weekNum > 0 ? `[data-week="${weekNum}"]` : "";
  const selector = `.dashboard-gb-daily-widget${attr}`;
  let sawWidget = false;
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view as { file?: TFile };
    if (view.file?.path !== file.path) continue;
    const root = leaf.containerEl.querySelector<HTMLElement>(selector);
    if (!root) continue;
    sawWidget = true;
    if (isGbDailyWidgetExpanded(root)) return true;
  }
  return sawWidget ? false : null;
}

export function readDailyWidgetExpandedFromTarget(target: HTMLElement): boolean | null {
  const root = target.closest<HTMLElement>(".dashboard-gb-daily-widget");
  if (!root) return null;
  return isGbDailyWidgetExpanded(root);
}

const dailyWidgetExpandedSession = new Map<string, boolean>();

export function setSessionDailyWidgetExpanded(path: string, expanded: boolean): void {
  dailyWidgetExpandedSession.set(path, expanded);
}

export function readSessionDailyWidgetExpanded(path: string): boolean | undefined {
  return dailyWidgetExpandedSession.get(path);
}

export function clearSessionDailyWidgetExpanded(path: string): void {
  dailyWidgetExpandedSession.delete(path);
}

export function captureGbDailyExpandedSession(file: TFile, target: HTMLElement): void {
  if (!DAILY_NOTE_PATH_RE.test(file.path)) return;
  const expanded = readDailyWidgetExpandedFromTarget(target);
  if (expanded !== null) setSessionDailyWidgetExpanded(file.path, expanded);
}

function seriesIdsWithQueueOrigins(layout: GbDailyWeekLayout): Set<string> {
  const ids = new Set<string>();
  for (const origin of Object.values(layout.queueOrigins ?? {})) ids.add(origin.seriesId);
  return ids;
}

function ensureSeriesShellsForQueueOrigins(layout: GbDailyWeekLayout): void {
  const seen = new Set<string>();
  for (const origin of Object.values(layout.queueOrigins ?? {})) {
    if (origin.seriesId === QUEUE_SERIES_ID || seen.has(origin.seriesId)) continue;
    seen.add(origin.seriesId);
    if (layout.series.some((s) => s.id === origin.seriesId)) continue;
    layout.series.push({
      id: origin.seriesId,
      label: origin.label ?? origin.seriesId,
      cids: [],
    });
  }
}

function sortSeriesToDefaultOrder(layout: GbDailyWeekLayout, videos: GbVideo[]): void {
  if (!videos.length) return;
  const defaultIds = buildDefaultDailyLayout(videos).series.map((s) => s.id);
  const byId = new Map(layout.series.map((s) => [s.id, s]));
  const ordered: GbDailySeriesLayout[] = [];
  for (const id of defaultIds) {
    const s = byId.get(id);
    if (s) ordered.push(s);
  }
  for (const s of layout.series) {
    if (!ordered.some((o) => o.id === s.id)) ordered.push(s);
  }
  layout.series = ordered;
}

function restoreCidFromQueue(layout: GbDailyWeekLayout, cid: string, videos?: GbVideo[]): boolean {
  const queue = layout.series.find((s) => s.id === QUEUE_SERIES_ID);
  if (!queue?.cids.includes(cid)) return false;
  queue.cids = queue.cids.filter((x) => x !== cid);
  layout.queueOrigins = layout.queueOrigins ?? {};
  const origin = layout.queueOrigins[cid];
  delete layout.queueOrigins[cid];
  if (!origin || origin.seriesId === QUEUE_SERIES_ID) return false;
  ensureSeriesShellsForQueueOrigins(layout);
  let home = layout.series.find((s) => s.id === origin.seriesId);
  if (!home) {
    home = { id: origin.seriesId, label: origin.label ?? origin.seriesId, cids: [] };
    layout.series.push(home);
  }
  const idx = Math.min(origin.index, home.cids.length);
  home.cids.splice(idx, 0, cid);
  if (videos?.length) sortSeriesToDefaultOrder(layout, videos);
  return true;
}

export async function readDailyLayoutForWeek(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  videos: GbVideo[],
): Promise<GbDailyWeekLayout> {
  const key = layoutKey(weekNum);
  let layout: GbDailyWeekLayout | undefined;

  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    const saved = store.dailyLayouts?.[key];
    if (saved?.series?.length) {
      const normalized = normalizeDailyLayout(saved, videos);
      layout = normalized;
      if (JSON.stringify(normalized) !== JSON.stringify(saved)) {
        store.dailyLayouts = { ...(store.dailyLayouts ?? {}), [key]: normalized };
      }
      return;
    }
    layout = buildDefaultDailyLayout(videos);
    store.dailyLayouts = { ...(store.dailyLayouts ?? {}), [key]: layout };
  });

  return layout!;
}

export async function mergeDailyLayoutOnSync(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  videos: GbVideo[],
): Promise<GbDailyWeekLayout> {
  const key = layoutKey(weekNum);
  let layout: GbDailyWeekLayout | undefined;

  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    layout = ensureDailyLayout(store.dailyLayouts?.[key], videos);
    store.dailyLayouts = { ...(store.dailyLayouts ?? {}), [key]: layout! };
  });

  return layout!;
}

/** Fetch curriculum from GB Online when not cached. Used for Sunday auto-sync and manual sync. */
export async function syncGbWeekIfUnsynced(
  app: App,
  settings: LifeAdminSettings,
  weekContext: GbWeekContext,
): Promise<GbVideo[]> {
  const store = await readGbOnlineData(app, settings.gbOnlineDataPath);
  const existing = store.weeks[String(weekContext.weekNum)]?.videos ?? [];
  if (existing.length) return existing;

  const cache = await syncGbWeekCatalog(app, settings, weekContext);
  await mergeDailyLayoutOnSync(app, settings, weekContext.weekNum, cache.videos);
  return cache.videos;
}

export async function saveDailyLayout(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  layout: GbDailyWeekLayout,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    store.dailyLayouts = { ...(store.dailyLayouts ?? {}), [layoutKey(weekNum)]: layout };
  });
}

function pinQueueIndex(index: number, series: GbDailySeriesLayout[]): number {
  if (!series.length || series[0]?.id !== QUEUE_SERIES_ID) return index;
  return index <= 0 ? 1 : index;
}

export async function reorderDailySeries(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    const key = layoutKey(weekNum);
    const layout = store.dailyLayouts?.[key];
    if (!layout?.series?.length) return;
    const series = [...layout.series];
    if (fromIndex < 0 || fromIndex >= series.length || toIndex < 0 || toIndex >= series.length) return;
    if (series[0]?.id === QUEUE_SERIES_ID && (fromIndex === 0 || toIndex === 0)) return;
    const pinnedTo = pinQueueIndex(toIndex, series);
    if (fromIndex === pinnedTo) return;
    const [item] = series.splice(fromIndex, 1);
    series.splice(pinnedTo, 0, item!);
    store.dailyLayouts = { ...(store.dailyLayouts ?? {}), [key]: { ...layout, series } };
  });
}

export async function reorderDailySeriesById(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  fromSeriesId: string,
  toSeriesId: string,
): Promise<void> {
  const store = await readGbOnlineData(app, settings.gbOnlineDataPath);
  const key = layoutKey(weekNum);
  const layout = store.dailyLayouts?.[key];
  if (!layout?.series?.length || !fromSeriesId || !toSeriesId || fromSeriesId === toSeriesId) return;
  const fromIndex = layout.series.findIndex((s) => s.id === fromSeriesId);
  const toIndex = layout.series.findIndex((s) => s.id === toSeriesId);
  if (fromIndex < 0 || toIndex < 0) return;
  await reorderDailySeries(app, settings, weekNum, fromIndex, toIndex);
}

export async function reorderDailyVideo(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  seriesId: string,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    const key = layoutKey(weekNum);
    const layout = store.dailyLayouts?.[key];
    if (!layout?.series?.length) return;
    const series = layout.series.map((s) => (s.id === seriesId ? { ...s, cids: [...s.cids] } : s));
    const group = series.find((s) => s.id === seriesId);
    if (!group) return;
    if (fromIndex < 0 || fromIndex >= group.cids.length || toIndex < 0 || toIndex >= group.cids.length) return;
    const [item] = group.cids.splice(fromIndex, 1);
    group.cids.splice(toIndex, 0, item!);
    store.dailyLayouts = { ...(store.dailyLayouts ?? {}), [key]: { ...layout, series } };
  });
}

export async function reorderDailyVideoByCid(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  seriesId: string,
  fromCid: string,
  toCid: string,
): Promise<void> {
  const store = await readGbOnlineData(app, settings.gbOnlineDataPath);
  const key = layoutKey(weekNum);
  const layout = store.dailyLayouts?.[key];
  if (!layout?.series?.length || !fromCid || !toCid || fromCid === toCid) return;
  const group = layout.series.find((s) => s.id === seriesId);
  if (!group) return;
  const fromIndex = group.cids.indexOf(fromCid);
  const toIndex = group.cids.indexOf(toCid);
  if (fromIndex < 0 || toIndex < 0) return;
  await reorderDailyVideo(app, settings, weekNum, seriesId, fromIndex, toIndex);
}

export async function toggleDailyQueueVideo(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  cid: string,
  fromSeriesId: string,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    const key = layoutKey(weekNum);
    const layout = store.dailyLayouts?.[key];
    if (!layout?.series?.length || !cid) return;

    const next = cloneLayout(layout);
    let queue = next.series.find((s) => s.id === QUEUE_SERIES_ID);
    if (!queue) {
      queue = queueSeries();
      next.series.unshift(queue);
    }
    next.queueOrigins = next.queueOrigins ?? {};
    const videos = store.weeks[key]?.videos ?? [];

    if (queue.cids.includes(cid)) {
      restoreCidFromQueue(next, cid, videos);
    } else if (fromSeriesId !== QUEUE_SERIES_ID) {
      const home = next.series.find((s) => s.id === fromSeriesId);
      if (!home) return;
      const index = home.cids.indexOf(cid);
      if (index < 0) return;
      next.queueOrigins[cid] = { seriesId: fromSeriesId, index, label: home.label };
      home.cids.splice(index, 1);
      if (queue.cids.length === 0) queue.cids.unshift(cid);
      else queue.cids.push(cid);
    }

    store.dailyLayouts = { ...(store.dailyLayouts ?? {}), [key]: next };
  });
}

export async function markDailyVideoWatched(
  app: App,
  settings: LifeAdminSettings,
  cid: string,
  dateStr?: string,
  weekNum?: number,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    store.watched[cid] = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : formatYmd(new Date());
    delete store.revealed[cid];
    if (weekNum != null) {
      const key = layoutKey(weekNum);
      const layout = store.dailyLayouts?.[key];
      if (layout) {
        const next = cloneLayout(layout);
        const videos = store.weeks[key]?.videos ?? [];
        restoreCidFromQueue(next, cid, videos);
        store.dailyLayouts = { ...(store.dailyLayouts ?? {}), [key]: next };
      }
    }
  });
}

export async function unmarkDailyVideoWatched(app: App, settings: LifeAdminSettings, cid: string): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    delete store.watched[cid];
  });
}

export async function toggleDailyVideoWatched(
  app: App,
  settings: LifeAdminSettings,
  cid: string,
  dateStr?: string,
  weekNum?: number,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    if (store.watched[cid]) {
      delete store.watched[cid];
      return;
    }
    store.watched[cid] = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : formatYmd(new Date());
    delete store.revealed[cid];
    if (weekNum != null) {
      const key = layoutKey(weekNum);
      const layout = store.dailyLayouts?.[key];
      if (layout) {
        const next = cloneLayout(layout);
        const videos = store.weeks[key]?.videos ?? [];
        restoreCidFromQueue(next, cid, videos);
        store.dailyLayouts = { ...(store.dailyLayouts ?? {}), [key]: next };
      }
    }
  });
}

export async function toggleDailySeriesWatched(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
  seriesId: string,
  dateStr?: string,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    const layout = store.dailyLayouts?.[layoutKey(weekNum)];
    const group = layout?.series.find((s) => s.id === seriesId);
    if (!group?.cids.length) return;

    const allWatched = group.cids.every((id) => store.watched[id]);
    const date = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : formatYmd(new Date());
    for (const id of group.cids) {
      if (allWatched) delete store.watched[id];
      else store.watched[id] = date;
      delete store.revealed[id];
    }
  });
}
