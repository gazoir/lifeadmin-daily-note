import { App, TFile, requestUrl } from "obsidian";
import type { LifeAdminSettings } from "./settings";
import { frontmatterFromMarkdown } from "./habits";
import { formatYmd } from "./utils";

export type GbTrack = "gb1" | "gb2" | "other";

export interface GbVideo {
  cid: string;
  title: string;
  track: GbTrack;
  section: string;
  url: string;
  permalink?: string;
  thumbnailUrl?: string;
  description?: string;
  /** False when GB Online shows a lock / scheduled release (parsed at sync). */
  playable?: boolean;
}

export const GB1_MASTER_COLLECTION = "collection-nluiatg9ane";

const GB1_CURRICULUM_LINK_RE =
  /\/programs\/(collection-nluiatg9ane)\?cid=(\d+)&(?:amp;)?permalink=([^"&\s]+)/gi;

export interface GbDailySeriesLayout {
  id: string;
  label: string;
  cids: string[];
}

export interface GbDailyQueueOrigin {
  seriesId: string;
  index: number;
  label?: string;
}

export interface GbDailyWeekLayout {
  series: GbDailySeriesLayout[];
  queueOrigins?: Record<string, GbDailyQueueOrigin>;
}

export interface GbDailyWeekUi {
  playlistOpen?: boolean;
  /** Whole widget `<details>` expanded (default true when unset) */
  widgetExpanded?: boolean;
  /** Series `<details>` left open by the user */
  openSeriesIds?: string[];
}

export interface GbWeekCache {
  fetchedAt: string;
  collectionSlug: string;
  weekUrl: string;
  videos: GbVideo[];
}

export interface GbOnlineDataStore {
  schemaVersion: 1;
  weeks: Record<string, GbWeekCache>;
  watched: Record<string, string>;
  /** CIDs where the user opened the video and the technique prompt is shown */
  revealed: Record<string, string>;
  /** Per-week playlist layout for GBOnline_Daily (series order + video order) */
  dailyLayouts?: Record<string, GbDailyWeekLayout>;
  /** Per-week UI state for GBOnline_Daily */
  dailyUi?: Record<string, GbDailyWeekUi>;
}

export interface GbWeekContext {
  weekNum: number;
  weekUrl: string;
  collectionSlug: string;
}

export interface GbTrackProgress {
  track: GbTrack;
  label: string;
  done: number;
  total: number;
  pct: number;
  nextVideo: GbVideo | null;
}

const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)\n```/;

const DATA_FILE_TEMPLATE = (json: string) => `# GB Online Data

Plugin-managed storage for the GB Online tracker. The \`json\` block below is read and written by **LifeAdmin** — you can open this note in Obsidian to inspect or debug values.

\`\`\`json
${json}
\`\`\`
`;

export function emptyGbOnlineStore(): GbOnlineDataStore {
  return { schemaVersion: 1, weeks: {}, watched: {}, revealed: {} };
}

function normalizeStore(raw: unknown): GbOnlineDataStore {
  const base = emptyGbOnlineStore();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) return base;
  const weeks: Record<string, GbWeekCache> = {};
  if (o.weeks && typeof o.weeks === "object") {
    for (const [k, v] of Object.entries(o.weeks as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const w = v as Record<string, unknown>;
      const videos = Array.isArray(w.videos)
        ? (w.videos as unknown[])
            .map(parseStoredVideo)
            .filter((x): x is GbVideo => x !== null)
        : [];
      weeks[k] = {
        fetchedAt: String(w.fetchedAt ?? ""),
        collectionSlug: String(w.collectionSlug ?? ""),
        weekUrl: String(w.weekUrl ?? ""),
        videos,
      };
    }
  }
  const watched: Record<string, string> = {};
  if (o.watched && typeof o.watched === "object") {
    for (const [cid, date] of Object.entries(o.watched as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) watched[cid] = String(date);
    }
  }
  const revealed: Record<string, string> = {};
  if (o.revealed && typeof o.revealed === "object") {
    for (const [cid, date] of Object.entries(o.revealed as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) revealed[cid] = String(date);
    }
  }
  let dailyLayouts: GbOnlineDataStore["dailyLayouts"];
  if (o.dailyLayouts && typeof o.dailyLayouts === "object") {
    dailyLayouts = {};
    for (const [wk, rawLayout] of Object.entries(o.dailyLayouts as Record<string, unknown>)) {
      if (!rawLayout || typeof rawLayout !== "object") continue;
      const rl = rawLayout as Record<string, unknown>;
      const series = Array.isArray(rl.series)
        ? (rl.series as unknown[])
            .map(parseDailySeries)
            .filter((x): x is NonNullable<typeof x> => x !== null)
        : [];
      if (series.length) {
        const queueOrigins = parseQueueOrigins(rl.queueOrigins);
        dailyLayouts![wk] = queueOrigins ? { series, queueOrigins } : { series };
      }
    }
  }
  let dailyUi: GbOnlineDataStore["dailyUi"];
  if (o.dailyUi && typeof o.dailyUi === "object") {
    dailyUi = {};
    for (const [wk, rawUi] of Object.entries(o.dailyUi as Record<string, unknown>)) {
      if (!rawUi || typeof rawUi !== "object") continue;
      const ui = rawUi as Record<string, unknown>;
      const openSeriesIds = Array.isArray(ui.openSeriesIds)
        ? ui.openSeriesIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : undefined;
      dailyUi[wk] = {
        playlistOpen: ui.playlistOpen === true,
        ...(openSeriesIds?.length ? { openSeriesIds } : {}),
      };
    }
  }
  return { schemaVersion: 1, weeks, watched, revealed, dailyLayouts, dailyUi };
}

function parseQueueOrigins(raw: unknown): Record<string, GbDailyQueueOrigin> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, GbDailyQueueOrigin> = {};
  for (const [cid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const seriesId = String(o.seriesId ?? "").trim();
    const index = Number(o.index);
    if (!seriesId || !Number.isFinite(index) || index < 0) continue;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : undefined;
    out[cid] = label ? { seriesId, index, label } : { seriesId, index };
  }
  return Object.keys(out).length ? out : undefined;
}

function parseDailySeries(raw: unknown): GbDailySeriesLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const id = String(s.id ?? "").trim();
  const label = String(s.label ?? "").trim();
  const cids = Array.isArray(s.cids) ? (s.cids as unknown[]).map(String).filter(Boolean) : [];
  if (!id || !label) return null;
  if (!cids.length && id !== "queue") return null;
  return { id, label, cids };
}

function parseStoredVideo(raw: unknown): GbVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const cid = String(v.cid ?? "").trim();
  const title = String(v.title ?? "").trim();
  if (!cid || !title) return null;
  const track = v.track === "gb1" || v.track === "gb2" ? v.track : "other";
  return {
    cid,
    title,
    track,
    section: String(v.section ?? ""),
    url: String(v.url ?? buildVideoUrl(String(v.collectionSlug ?? ""), cid)),
    permalink: String(v.permalink ?? "").trim() || permalinkFromUrl(String(v.url ?? "")),
    thumbnailUrl: String(v.thumbnailUrl ?? "").trim() || undefined,
    description: String(v.description ?? "").trim() || undefined,
    playable: v.playable === false ? false : v.playable === true ? true : undefined,
  };
}

export function isGbVideoPlayable(video: GbVideo | undefined): boolean {
  if (!video) return false;
  if (video.playable === true) return true;
  if (video.playable === false) {
    // Recover from earlier syncs that treated always-present lock-icon markup as unplayable.
    if (/alpha\.uscreencdn\.com/i.test(video.thumbnailUrl ?? "")) return true;
    return false;
  }
  return true;
}

export function buildVideoUrl(collectionSlug: string, cid: string, permalink?: string): string {
  if (permalink) {
    return `https://online.graciebarra.com/programs/${collectionSlug}?cid=${cid}&permalink=${encodeURIComponent(permalink)}`;
  }
  return `https://online.graciebarra.com/programs/${collectionSlug}?cid=${cid}`;
}

function permalinkFromUrl(url: string): string | undefined {
  const m = url.match(/[?&](?:amp;)?permalink=([^&]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

export function buildCollectionHomepageUrl(collectionSlug: string): string {
  return `https://online.graciebarra.com/programs/${collectionSlug}/collection_homepage?playlist_position=sidebar&preview=false`;
}

export function parseWeekNumFromUrl(url: string): number | null {
  const m = url.match(/collection-weekly-training-plan-week-(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function parseCollectionSlugFromUrl(url: string): string | null {
  const m = url.match(/\/programs\/(collection-weekly-training-plan-week-\d+)/i);
  return m ? m[1] : null;
}

function isoWeekParts(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year, week };
}

function weeklyNotePath(folder: string, d: Date): string {
  const { year, week } = isoWeekParts(d);
  return `${folder}/${year}-W${String(week).padStart(2, "0")}.md`;
}

/** On Sunday, look up the upcoming ISO week so you can sync/preview next week's curriculum. */
export function weeklyNoteDateForGb(referenceDate: string): Date {
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(referenceDate) ? referenceDate : formatYmd(new Date());
  const d = new Date(`${ref}T12:00:00`);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d;
}

export function isSundayYmd(referenceDate: string): boolean {
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(referenceDate) ? referenceDate : formatYmd(new Date());
  return new Date(`${ref}T12:00:00`).getDay() === 0;
}

function gbWeekUrlFromFrontmatter(fm: Record<string, unknown>): string {
  const raw = fm["GB Week"] ?? fm.gb_week_url ?? fm["gb week"];
  if (typeof raw === "string") return raw.trim();
  // Foldstate / bad YAML sometimes leaves a bare week number — ignore it.
  if (typeof raw === "number") return "";
  return String(raw ?? "").trim();
}

async function readFrontmatterPreferDisk(app: App, file: TFile): Promise<Record<string, unknown>> {
  try {
    const diskFm = frontmatterFromMarkdown(await app.vault.read(file));
    if (Object.keys(diskFm).length) return diskFm;
  } catch {
    /* use metadata cache below */
  }
  return app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}

function buildGbWeekContext(weekUrl: string): GbWeekContext | null {
  if (!weekUrl) return null;
  const slug = parseCollectionSlugFromUrl(weekUrl);
  const weekNum = parseWeekNumFromUrl(weekUrl);
  if (!slug || !weekNum || weekNum < 1) return null;
  return { weekNum, weekUrl, collectionSlug: slug };
}

export async function resolveGbWeekContext(
  app: App,
  settings: LifeAdminSettings,
  noteFile: TFile,
  referenceDate: string,
): Promise<GbWeekContext | null> {
  const noteFm = await readFrontmatterPreferDisk(app, noteFile);
  const fromNote = buildGbWeekContext(gbWeekUrlFromFrontmatter(noteFm));
  if (fromNote) return fromNote;

  const refDate = weeklyNoteDateForGb(referenceDate);
  const wPath = weeklyNotePath(settings.weeklyNotesFolder, refDate);
  const wFile = app.vault.getAbstractFileByPath(wPath);
  if (!(wFile instanceof TFile)) return null;

  const weeklyFm = await readFrontmatterPreferDisk(app, wFile);
  const fromWeekly = buildGbWeekContext(gbWeekUrlFromFrontmatter(weeklyFm));
  if (fromWeekly) return fromWeekly;

  // Last resort: metadata cache can lag after a manual frontmatter repair.
  const cachedWeeklyFm = app.metadataCache.getFileCache(wFile)?.frontmatter ?? {};
  return buildGbWeekContext(gbWeekUrlFromFrontmatter(cachedWeeklyFm));
}

let storeAccessChain: Promise<unknown> = Promise.resolve();

function cloneGbOnlineStore(store: GbOnlineDataStore): GbOnlineDataStore {
  return structuredClone(store);
}

function enqueueGbOnlineStoreAccess<T>(fn: () => Promise<T>): Promise<T> {
  const next = storeAccessChain.then(fn, fn);
  storeAccessChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readGbOnlineDataFromVault(app: App, path: string): Promise<GbOnlineDataStore> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return emptyGbOnlineStore();
  const text = await app.vault.read(file);
  const m = text.match(JSON_BLOCK_RE);
  if (!m?.[1]) return emptyGbOnlineStore();
  try {
    return normalizeStore(JSON.parse(m[1]));
  } catch {
    return emptyGbOnlineStore();
  }
}

async function writeGbOnlineDataToVault(app: App, path: string, data: GbOnlineDataStore): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  const content = DATA_FILE_TEMPLATE(json);
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    const parts = path.split("/");
    const name = parts.pop()!;
    const folder = parts.join("/");
    if (folder && !app.vault.getAbstractFileByPath(folder)) {
      await app.vault.createFolder(folder);
    }
    await app.vault.create(path, content);
  }
}

/** All GB Online store reads/writes are serialized and always hit the vault (no stale in-memory cache). */
export async function readGbOnlineData(app: App, path: string): Promise<GbOnlineDataStore> {
  return enqueueGbOnlineStoreAccess(async () => cloneGbOnlineStore(await readGbOnlineDataFromVault(app, path)));
}

export async function updateGbOnlineData(
  app: App,
  path: string,
  mutator: (store: GbOnlineDataStore) => void | Promise<void>,
): Promise<GbOnlineDataStore> {
  return enqueueGbOnlineStoreAccess(async () => {
    const store = cloneGbOnlineStore(await readGbOnlineDataFromVault(app, path));
    await mutator(store);
    await writeGbOnlineDataToVault(app, path, store);
    return store;
  });
}

export async function writeGbOnlineData(app: App, path: string, data: GbOnlineDataStore): Promise<void> {
  const next = cloneGbOnlineStore(data);
  await updateGbOnlineData(app, path, (store) => {
    store.schemaVersion = next.schemaVersion;
    store.weeks = next.weeks;
    store.watched = next.watched;
    store.revealed = next.revealed;
    store.dailyLayouts = next.dailyLayouts;
    store.dailyUi = next.dailyUi;
  });
}

function inferTrackFromTitle(title: string): GbTrack | null {
  const t = title.trim();
  if (/\bGB1\b/.test(t) && !/\bGB2\b/.test(t)) return "gb1";
  if (/\bGB2\b/.test(t)) return "gb2";
  return null;
}

function applySectionDivider(section: string, currentMajor: GbTrack): GbTrack {
  const s = section.trim();
  if (s === "GB1") return "gb1";
  if (/GB2/i.test(s)) return "gb2";
  if (/GBK|Games|Tiny Champions|Little Champions|Juniors|Kids/i.test(s)) return "other";
  return currentMajor;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .trim();
}

function extractTitleFromChunk(chunk: string): string {
  const titleMatch =
    chunk.match(/class="content-item-title[^"]*"[^>]*title="([^"]*)"/) ??
    chunk.match(/data-area="title"[^>]*title="([^"]*)"/) ??
    chunk.match(/class="content-item-title[^"]*"[^>]*>([^<]+)</) ??
    chunk.match(/data-area="title"[^>]*>([^<]+)</);
  return decodeHtmlEntities(titleMatch?.[1] ?? "");
}

function extractThumbnailFromChunk(chunk: string): string {
  const previewMatch = chunk.match(/data-area="preview-image"[^>]*\ssrc="([^"]+)"/);
  if (previewMatch) return decodeHtmlEntities(previewMatch[1]!);
  const srcsetMatch = chunk.match(/srcset="([^"]*width=350[^"]*)"/);
  if (srcsetMatch) {
    const first = srcsetMatch[1].split(",")[0]?.trim().split(/\s+/)[0];
    if (first) return decodeHtmlEntities(first);
  }
  const srcMatch = chunk.match(/\ssrc="(https:\/\/[^"]+)"/);
  return srcMatch ? decodeHtmlEntities(srcMatch[1]!) : "";
}

function isChunkPlayable(chunk: string): boolean {
  const previewImg = chunk.match(/<img[^>]*data-area="preview-image"[^>]*>/i)?.[0] ?? "";
  if (previewImg && /brightness-\[65%\]/i.test(previewImg)) return false;
  if (/scheduled to be released/i.test(chunk)) return false;
  return true;
}

function extractDescriptionFromChunk(chunk: string): string {
  const descMatch =
    chunk.match(/class="content-item-description[^"]*"[^>]*>([^<]+)</) ??
    chunk.match(/data-area="description"[^>]*>([^<]+)</);
  return decodeHtmlEntities(descMatch?.[1] ?? "");
}

function trackForVideo(title: string, section: string, currentMajor: GbTrack): GbTrack {
  const fromTitle = inferTrackFromTitle(title);
  let track: GbTrack = fromTitle ?? currentMajor;
  if (track === "other" && currentMajor !== "other") track = currentMajor;
  if (track === "other" && /GB2/i.test(section)) track = "gb2";
  if (track === "other" && section.trim() === "GB1") track = "gb1";
  return track;
}

function addVideo(
  byCid: Map<string, GbVideo>,
  ctx: GbWeekContext,
  cid: string,
  title: string,
  section: string,
  currentMajor: GbTrack,
  permalink?: string,
  chunk?: string,
): void {
  if (!cid || !title) return;
  const body = chunk ?? "";
  byCid.set(cid, {
    cid,
    title,
    track: trackForVideo(title, section, currentMajor),
    section,
    url: buildVideoUrl(ctx.collectionSlug, cid, permalink),
    permalink,
    thumbnailUrl: extractThumbnailFromChunk(body) || undefined,
    description: extractDescriptionFromChunk(body) || undefined,
    playable: body ? isChunkPlayable(body) : undefined,
  });
}

/** Sidebar playlist HTML — includes data-permalink on every video (required for mobile deep links). */
export function parseProgramContentHtml(html: string, ctx: GbWeekContext): GbVideo[] {
  const byCid = new Map<string, GbVideo>();
  if (!html.trim()) return [];

  let currentMajor: GbTrack = "other";
  let currentSection = "";

  const parts = html.split(
    /(?=<div class="m-3 ps-2[^"]*" data-area="playlist-divider">|<div data-cid="\d+" data-permalink=")/gi,
  );

  for (const part of parts) {
    const dividerMatch = part.match(
      /^<div class="m-3 ps-2[^"]*" data-area="playlist-divider">\s*([\s\S]*?)<\/div>/,
    );
    if (dividerMatch) {
      currentSection = dividerMatch[1].replace(/<[^>]+>/g, "").trim();
      currentMajor = applySectionDivider(currentSection, currentMajor);
      continue;
    }

    const videoMatch = part.match(/^<div data-cid="(\d+)" data-permalink="([^"]*)"/);
    if (!videoMatch) continue;

    const title = extractTitleFromChunk(part);
    addVideo(byCid, ctx, videoMatch[1]!, title, currentSection, currentMajor, videoMatch[2], part);
  }

  return Array.from(byCid.values());
}

export function parseCollectionHomepageHtml(html: string, ctx: GbWeekContext): GbVideo[] {
  const byCid = new Map<string, GbVideo>();
  if (!html.trim()) return [];

  let currentMajor: GbTrack = "other";
  let currentSection = "";

  const combinedRe =
    /<div class="playlist-divider[^"]*"[^>]*data-area="playlist-divider"[^>]*>\s*([\s\S]*?)<\/div>|<div class="content-item[^"]*"[^>]*data-cid="(\d+)"[^>]*>([\s\S]*?)(?=<div class="content-item|<div class="playlist-divider|<\/ds-swiper|<div class="py-4 lg:py-8" id="comments)/gi;

  let m: RegExpExecArray | null;
  while ((m = combinedRe.exec(html)) !== null) {
    if (m[1] !== undefined) {
      currentSection = m[1].replace(/<[^>]+>/g, "").trim();
      currentMajor = applySectionDivider(currentSection, currentMajor);
      continue;
    }

    const cid = m[2]!;
    const chunk = m[3] ?? "";
    const title = extractTitleFromChunk(chunk);
    addVideo(byCid, ctx, cid, title, currentSection, currentMajor, undefined, chunk);
  }

  if (byCid.size) return Array.from(byCid.values());

  return parseCollectionHtmlFallback(html, ctx);
}

function parseCollectionHtmlFallback(html: string, ctx: GbWeekContext): GbVideo[] {
  const byCid = new Map<string, GbVideo>();

  const homepageRe =
    /data-cid="(\d+)"([\s\S]{0,5000}?)class="content-item-title[^"]*"[^>]*title="([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = homepageRe.exec(html)) !== null) {
    const title = decodeHtmlEntities(m[3] ?? "");
    const chunk = m[2] ?? "";
    addVideo(byCid, ctx, m[1]!, title, "", "other", undefined, chunk);
  }

  const playlistRe =
    /data-cid="(\d+)"[^>]*data-permalink="([^"]*)"([\s\S]{0,5000}?)data-area="title"[^>]*title="([^"]*)"/gi;
  while ((m = playlistRe.exec(html)) !== null) {
    const title = decodeHtmlEntities(m[4] ?? "");
    const chunk = m[3] ?? "";
    addVideo(byCid, ctx, m[1]!, title, "", "other", m[2], chunk);
  }

  return Array.from(byCid.values());
}

const GB_FETCH_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml",
  "X-Fastly-Origin": "online",
};

function responseHtml(res: { text?: string; arrayBuffer?: ArrayBuffer }): string {
  if (res.text) return res.text;
  if (res.arrayBuffer?.byteLength) return new TextDecoder("utf-8").decode(res.arrayBuffer);
  return "";
}

export function buildProgramContentUrl(ctx: GbWeekContext): string {
  return `https://online.graciebarra.com/programs/${ctx.collectionSlug}/program_content?permalink=week-${ctx.weekNum}-class-a-technique-1`;
}

function mergePermalinksIntoVideos(videos: GbVideo[], permalinksByCid: Map<string, string>, collectionSlug: string): GbVideo[] {
  return videos.map((v) => {
    const permalink = permalinksByCid.get(v.cid) ?? v.permalink;
    if (!permalink || v.url.includes("permalink=")) return v;
    return {
      ...v,
      permalink,
      url: buildVideoUrl(collectionSlug, v.cid, permalink),
    };
  });
}

export async function loadGb1MobileLinks(
  app: App,
  curriculumPath: string,
): Promise<Map<string, { cid: string; collectionSlug: string }>> {
  const map = new Map<string, { cid: string; collectionSlug: string }>();
  const file = app.vault.getAbstractFileByPath(curriculumPath);
  if (!(file instanceof TFile)) return map;
  const text = await app.vault.read(file);
  GB1_CURRICULUM_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GB1_CURRICULUM_LINK_RE.exec(text)) !== null) {
    map.set(decodeURIComponent(m[3]!), { cid: m[2]!, collectionSlug: m[1]! });
  }
  return map;
}

/** GB1 technique links in BJJ Curriculum use the master catalog — required for mobile app deep links. */
export function applyGb1MobileUrls(
  videos: GbVideo[],
  mobileByPermalink: Map<string, { cid: string; collectionSlug: string }>,
): GbVideo[] {
  if (!mobileByPermalink.size) return videos;
  return videos.map((v) => {
    if (v.track !== "gb1" || !v.permalink) return v;
    const mobile = mobileByPermalink.get(v.permalink);
    if (!mobile) return v;
    return {
      ...v,
      url: buildVideoUrl(mobile.collectionSlug, mobile.cid, v.permalink),
    };
  });
}

function permalinksFromHtml(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /data-cid="(\d+)"[^>]*data-permalink="([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    map.set(m[1]!, m[2]!);
  }
  return map;
}

export async function fetchWeekCatalog(ctx: GbWeekContext): Promise<GbVideo[]> {
  const programContentUrl = buildProgramContentUrl(ctx);
  const homepageUrl = buildCollectionHomepageUrl(ctx.collectionSlug);
  let lastStatus = 0;
  let lastSize = 0;
  let homepageVideos: GbVideo[] | null = null;
  let programHtml = "";

  for (const url of [programContentUrl, homepageUrl]) {
    const res = await requestUrl({ url, headers: GB_FETCH_HEADERS });
    lastStatus = res.status;
    if (res.status >= 400) continue;
    const html = responseHtml(res);
    lastSize = html.length;

    if (url === programContentUrl) {
      programHtml = html;
      const videos = parseProgramContentHtml(html, ctx);
      if (videos.length) return videos;
      continue;
    }

    const videos = parseCollectionHomepageHtml(html, ctx);
    if (videos.length) homepageVideos = videos;
  }

  if (homepageVideos?.length && programHtml) {
    return mergePermalinksIntoVideos(
      homepageVideos,
      permalinksFromHtml(programHtml),
      ctx.collectionSlug,
    );
  }

  if (homepageVideos?.length) return homepageVideos;

  throw new Error(
    `GB Online parser found 0 videos (last HTTP ${lastStatus}, ${lastSize} bytes). Open the week in a browser while logged in, then retry.`,
  );
}

export async function syncGbWeekCatalog(
  app: App,
  settings: LifeAdminSettings,
  ctx: GbWeekContext,
): Promise<GbWeekCache> {
  const mobileLinks = await loadGb1MobileLinks(app, settings.gb1CurriculumPath);
  const videos = applyGb1MobileUrls(await fetchWeekCatalog(ctx), mobileLinks);
  const key = String(ctx.weekNum);
  const cache: GbWeekCache = {
    fetchedAt: new Date().toISOString(),
    collectionSlug: ctx.collectionSlug,
    weekUrl: ctx.weekUrl,
    videos,
  };
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    store.weeks[key] = cache;
  });
  return cache;
}

/** Debug: remove cached catalog for a week so the widget shows the unsynced state. */
export async function clearGbWeekSync(
  app: App,
  settings: LifeAdminSettings,
  weekNum: number,
): Promise<void> {
  const key = String(weekNum);
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    delete store.weeks[key];
    if (store.dailyLayouts) delete store.dailyLayouts[key];
    if (store.dailyUi) delete store.dailyUi[key];
  });
}

export function computeTrackProgress(
  videos: GbVideo[],
  watched: Record<string, string>,
  track: GbTrack,
): GbTrackProgress {
  const list = videos.filter((v) => v.track === track);
  const done = list.filter((v) => watched[v.cid]).length;
  const total = list.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const nextVideo = list.find((v) => !watched[v.cid]) ?? null;
  return {
    track,
    label: track === "gb1" ? "GB1" : "GB2",
    done,
    total,
    pct,
    nextVideo,
  };
}

export async function setVideoRevealed(
  app: App,
  settings: LifeAdminSettings,
  cid: string,
  dateStr?: string,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    store.revealed[cid] = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : formatYmd(new Date());
  });
}

export async function setVideoWatched(
  app: App,
  settings: LifeAdminSettings,
  cid: string,
  watched: boolean,
  dateStr?: string,
): Promise<void> {
  await updateGbOnlineData(app, settings.gbOnlineDataPath, (store) => {
    if (watched) {
      store.watched[cid] = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : formatYmd(new Date());
      delete store.revealed[cid];
    } else {
      delete store.watched[cid];
    }
  });
}

export function referenceDateForNote(app: App, file: TFile): string {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const ref = String(fm.reference_date ?? fm.noteDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ref)) return ref;
  if (/^\d{4}-\d{2}-\d{2}$/.test(file.basename)) return file.basename;
  return formatYmd(new Date());
}
