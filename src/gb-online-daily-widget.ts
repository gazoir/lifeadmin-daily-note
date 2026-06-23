import type { GbDailyProgress, GbDailyWeekLayout } from "./gb-online-daily";
import { QUEUE_SERIES_ID, isSeriesPlayable, sortSeriesForPlayabilityDisplay } from "./gb-online-daily";
import type { GbVideo, GbWeekContext } from "./gb-online-data";
import { isGbVideoPlayable } from "./gb-online-data";
import { escapeAttr } from "./utils";

export interface GbOnlineDailyWidgetModel {
  weekContext: GbWeekContext | null;
  referenceDate: string;
  needsSync: boolean;
  progress: GbDailyProgress;
  layout: GbDailyWeekLayout;
  videos: GbVideo[];
  watched: Record<string, string>;
  playlistOpen: boolean;
  widgetExpanded: boolean;
  openSeriesIds: string[];
  logoUrl: string;
  error?: string;
}

function thumbImg(url: string | undefined, className: string, alt: string): string {
  if (!url) {
    return `<span class="${className} dashboard-gb-thumb-placeholder" aria-hidden="true"></span>`;
  }
  return `<img class="${className}" src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async" />`;
}

function progressBarHtml(referenceDate: string, pct: number): string {
  return `<div class="dashboard-gb-daily-progress-wrap">
  <div class="dashboard-gb-daily-progress" role="button" tabindex="0" data-action="gb-daily-toggle-playlist" data-date="${escapeAttr(referenceDate)}" title="Show or hide playlist">
    <div class="dashboard-gb-daily-progress-track"></div>
    <div class="dashboard-gb-daily-progress-fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div>
  </div>
</div>`;
}

function syncPromptCard(weekNum: number, referenceDate: string): string {
  const thumb = `<button type="button" class="dashboard-gb-daily-sync-thumb dashboard-gb-daily-featured-thumb" data-action="gb-sync" data-date="${escapeAttr(referenceDate)}" title="Sync Week ${weekNum} curriculum">
    <span class="dashboard-gb-daily-sync-label">SYNC</span>
    <span class="dashboard-gb-daily-sync-week">Week ${weekNum}</span>
  </button>`;
  return `<div class="dashboard-gb-daily-featured dashboard-gb-daily-sync-prompt">
  <div class="dashboard-gb-daily-featured-main">
    <span class="dashboard-gb-daily-featured-thumb-link">${thumb}</span>
  </div>
  <div class="dashboard-gb-video-desc dashboard-gb-daily-sync-desc-empty" aria-hidden="true">&#8203;</div>
</div>`;
}

const SECTION_FOLD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

function headerCountLabel(progress: GbDailyProgress, needsSync: boolean): string {
  if (needsSync) return "Not synced";
  if (!progress.total) return "—";
  return `${progress.done}/${progress.total} (${progress.pct}%)`;
}

function sectionHeaderHtml(
  weekNum: number | null,
  pct: number,
  countLabel: string,
  logoUrl: string,
): string {
  const weekLabel = weekNum != null ? `WEEK ${weekNum}` : "WEEK";
  const clamped = Math.max(0, Math.min(100, pct));
  const logo = logoUrl
    ? `<img class="dashboard-gb-daily-section-logo" src="${escapeAttr(logoUrl)}" alt="" decoding="async" />`
    : "";
  return `<summary class="dashboard-gb-daily-section-header">
  <span class="dashboard-gb-daily-section-fill" style="width:${clamped}%"></span>
  <span class="dashboard-gb-daily-section-title">${logo}<span class="dashboard-gb-daily-section-week">${weekLabel}</span></span>
  <span class="dashboard-gb-daily-section-count">${escapeAttr(countLabel)}</span>
  <span class="dashboard-gb-daily-section-fold">${SECTION_FOLD_SVG}</span>
</summary>`;
}

function collapsibleWidgetShell(
  weekNum: number | null,
  referenceDate: string,
  pct: number,
  countLabel: string,
  logoUrl: string,
  widgetExpanded: boolean,
  bodyHtml: string,
  extraRootClass = "",
): string {
  const weekAttr = weekNum != null ? ` data-week="${weekNum}"` : "";
  const openAttr = widgetExpanded ? " open" : "";
  return `<details class="dashboard-widget dashboard-gb-daily dashboard-gb-daily-widget${extraRootClass}" data-widget="gb-online-daily" data-context-date="${escapeAttr(referenceDate)}"${weekAttr}${openAttr}>
  ${sectionHeaderHtml(weekNum, pct, countLabel, logoUrl)}
  <div class="dashboard-gb-daily-body">
${bodyHtml}
  </div>
</details>`;
}

function playlistFooter(referenceDate: string): string {
  return `<div class="dashboard-gb-daily-playlist-footer">
  <button type="button" class="dashboard-gb-daily-footer-btn" data-action="gb-open-week" data-date="${escapeAttr(referenceDate)}">Open week</button>
  <button type="button" class="dashboard-gb-daily-footer-btn" data-action="gb-sync" data-date="${escapeAttr(referenceDate)}">Sync</button>
  <button type="button" class="dashboard-gb-daily-footer-btn dashboard-gb-daily-footer-btn-debug" data-action="gb-clear-sync" data-date="${escapeAttr(referenceDate)}" title="Clear sync cache for this week (debug)">Clear sync</button>
</div>`;
}
function featuredCard(video: GbVideo, referenceDate: string): string {
  const desc = video.description
    ? `<div class="dashboard-gb-video-desc">${escapeAttr(video.description)}</div>`
    : "";
  const trackLabel = video.track === "gb1" ? "GB1" : "GB2";
  const unplayable = !isGbVideoPlayable(video);
  const unplayableCls = unplayable ? " is-unplayable" : "";
  const thumbContent = thumbImg(video.thumbnailUrl, "dashboard-gb-daily-featured-thumb", video.title);
  const thumbLink = unplayable
    ? `<span class="dashboard-gb-daily-featured-thumb-link dashboard-gb-daily-featured-thumb-placeholder${unplayableCls}" title="Not released yet">${thumbContent}</span>`
    : `<span class="dashboard-gb-daily-featured-thumb-link" role="button" tabindex="0" data-action="gb-daily-featured" data-cid="${escapeAttr(video.cid)}" data-url="${escapeAttr(video.url)}" data-date="${escapeAttr(referenceDate)}" title="Open and mark watched">${thumbContent}</span>`;
  return `<div class="dashboard-gb-daily-featured${unplayableCls}">
  <div class="dashboard-gb-daily-featured-main">
    ${thumbLink}
    <div class="dashboard-gb-daily-featured-body">
      <div class="dashboard-gb-daily-featured-label">Next · ${trackLabel}</div>
      <div class="dashboard-gb-daily-featured-title">${escapeAttr(video.title)}</div>
    </div>
  </div>
  ${desc}
</div>`;
}

function seriesToggleMark(cids: string[], watched: Record<string, string>): string {
  const done = cids.filter((cid) => watched[cid]).length;
  if (!cids.length || done === 0) return "○";
  if (done === cids.length) return "✓";
  return "◐";
}

function videoToggleMark(watched: boolean): string {
  return watched ? "✓" : "○";
}

function playlistVideoRow(
  video: GbVideo,
  seriesId: string,
  watched: boolean,
  referenceDate: string,
  inQueue: boolean,
  unplayable: boolean,
): string {
  const cls = watched ? " is-watched" : "";
  const queueCls = inQueue ? " is-queued" : "";
  const unplayableCls = unplayable ? " is-unplayable" : "";
  const queueHint = inQueue ? "Remove from queue" : "Add to queue";
  return `<div class="dashboard-gb-daily-video${cls}${queueCls}${unplayableCls}" data-cid="${escapeAttr(video.cid)}" data-series-id="${escapeAttr(seriesId)}">
  <button type="button" class="dashboard-gb-daily-video-toggle" data-action="gb-daily-toggle-watched" data-cid="${escapeAttr(video.cid)}" data-date="${escapeAttr(referenceDate)}" title="${watched ? "Mark unwatched" : "Mark watched / skip"}">${videoToggleMark(watched)}</button>
  <span class="dashboard-gb-daily-grip" draggable="true" data-gb-daily-drag="video" data-series-id="${escapeAttr(seriesId)}" data-cid="${escapeAttr(video.cid)}" title="Drag to reorder">☰</span>
  <span class="dashboard-gb-daily-video-title" role="button" tabindex="0" data-action="gb-daily-queue-toggle" data-cid="${escapeAttr(video.cid)}" data-series-id="${escapeAttr(seriesId)}" title="${queueHint}">${escapeAttr(video.title)}</span>
</div>`;
}

function playlistSeries(
  seriesId: string,
  label: string,
  cids: string[],
  videoByCid: Map<string, GbVideo>,
  watched: Record<string, string>,
  referenceDate: string,
  openSeriesIds: Set<string>,
): string {
  const inQueue = seriesId === QUEUE_SERIES_ID;
  const items = cids
    .map((cid) => videoByCid.get(cid))
    .filter((v): v is GbVideo => Boolean(v))
    .map((v) =>
      playlistVideoRow(
        v,
        seriesId,
        Boolean(watched[v.cid]),
        referenceDate,
        inQueue,
        !isGbVideoPlayable(v),
      ),
    )
    .join("\n");
  const done = cids.filter((cid) => watched[cid]).length;
  const seriesMark = seriesToggleMark(cids, watched);
  const pinned = seriesId === QUEUE_SERIES_ID ? " is-pinned" : "";
  const unplayableSeries = seriesId !== QUEUE_SERIES_ID && !isSeriesPlayable(cids, videoByCid);
  const unplayableCls = unplayableSeries ? " is-unplayable" : "";
  const grip =
    seriesId === QUEUE_SERIES_ID
      ? `<span class="dashboard-gb-daily-grip dashboard-gb-daily-grip-static" aria-hidden="true">☰</span>`
      : `<span class="dashboard-gb-daily-grip" draggable="true" data-gb-daily-drag="series" data-series-id="${escapeAttr(seriesId)}" title="Drag to reorder series">☰</span>`;
  const openAttr = openSeriesIds.has(seriesId) ? " open" : "";
  return `<div class="dashboard-gb-daily-series${pinned}${unplayableCls}" data-series-id="${escapeAttr(seriesId)}">
  ${grip}
  <details class="dashboard-gb-daily-series-details"${openAttr}>
    <summary><button type="button" class="dashboard-gb-daily-series-toggle" data-action="gb-daily-toggle-series-watched" data-series-id="${escapeAttr(seriesId)}" data-date="${escapeAttr(referenceDate)}" title="Toggle all in series">${seriesMark}</button> ${escapeAttr(label)} <span class="dashboard-gb-daily-series-count">${done}/${cids.length}</span></summary>
    <div class="dashboard-gb-daily-series-videos">${items || `<p class="dashboard-gb-empty">Empty</p>`}</div>
  </details>
</div>`;
}

function playlistPanel(
  layout: GbDailyWeekLayout,
  videos: GbVideo[],
  watched: Record<string, string>,
  referenceDate: string,
  playlistOpen: boolean,
  openSeriesIds: Set<string>,
): string {
  const videoByCid = new Map(videos.map((v) => [v.cid, v]));
  const visible = layout.series.filter((s) => s.id === QUEUE_SERIES_ID || s.cids.length > 0);
  const series = sortSeriesForPlayabilityDisplay(visible, videoByCid)
    .map((s) => playlistSeries(s.id, s.label, s.cids, videoByCid, watched, referenceDate, openSeriesIds))
    .join("\n");
  const hidden = playlistOpen ? "" : " hidden";
  return `<div class="dashboard-gb-daily-playlist${playlistOpen ? " is-open" : ""}"${hidden}>${series}${playlistFooter(referenceDate)}</div>`;
}

export function buildGbOnlineDailyWidgetHtml(model: GbOnlineDailyWidgetModel): string {
  const {
    weekContext,
    referenceDate,
    needsSync,
    progress,
    layout,
    videos,
    watched,
    playlistOpen,
    widgetExpanded,
    openSeriesIds,
    logoUrl,
    error,
  } = model;

  const countLabel = headerCountLabel(progress, needsSync);

  if (error) {
    return collapsibleWidgetShell(
      weekContext?.weekNum ?? null,
      referenceDate,
      0,
      countLabel,
      logoUrl,
      widgetExpanded,
      `  <p class="dashboard-gb-error">${escapeAttr(error)}</p>`,
    );
  }

  if (!weekContext) {
    return collapsibleWidgetShell(
      null,
      referenceDate,
      0,
      countLabel,
      logoUrl,
      widgetExpanded,
      `  <p class="dashboard-gb-error">No GB week found. Add <code>GB Week:</code> to this note or the current weekly note.</p>`,
    );
  }

  if (needsSync || !videos.length) {
    const openSeries = new Set(openSeriesIds);
    const body = `  ${syncPromptCard(weekContext.weekNum, referenceDate)}
  ${progressBarHtml(referenceDate, 0)}
  ${playlistPanel(layout, videos, watched, referenceDate, playlistOpen, openSeries)}`;
    return collapsibleWidgetShell(
      weekContext.weekNum,
      referenceDate,
      0,
      countLabel,
      logoUrl,
      widgetExpanded,
      body,
    );
  }

  const featured = progress.featured
    ? featuredCard(progress.featured, referenceDate)
    : `<p class="dashboard-gb-all-done">All videos watched for this week ✓</p>`;
  const progressBar = progressBarHtml(referenceDate, progress.pct);
  const openCls = playlistOpen ? " is-playlist-open" : "";
  const openSeries = new Set(openSeriesIds);
  const body = `  ${featured}
  ${progressBar}
  ${playlistPanel(layout, videos, watched, referenceDate, playlistOpen, openSeries)}`;

  return collapsibleWidgetShell(
    weekContext.weekNum,
    referenceDate,
    progress.pct,
    countLabel,
    logoUrl,
    widgetExpanded,
    body,
    openCls,
  );
}
