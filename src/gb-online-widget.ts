import type { GbTrack, GbTrackProgress, GbVideo, GbWeekContext } from "./gb-online-data";
import { escapeAttr } from "./utils";

export interface GbOnlineWidgetModel {
  weekContext: GbWeekContext | null;
  referenceDate: string;
  fetchedAt: string | null;
  needsSync: boolean;
  gb1: GbTrackProgress;
  gb2: GbTrackProgress;
  videos: GbVideo[];
  watched: Record<string, string>;
  revealed: Record<string, string>;
  error?: string;
}

function progressBar(pct: number): string {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="dashboard-gb-progress-track"><div class="dashboard-gb-progress-fill" style="width:${w}%"></div></div>`;
}

function thumbImg(url: string | undefined, className: string, alt: string): string {
  if (!url) {
    return `<span class="${className} dashboard-gb-thumb-placeholder" aria-hidden="true"></span>`;
  }
  return `<img class="${className}" src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async" />`;
}

function descriptionBlock(video: GbVideo, visible: boolean): string {
  if (!visible || !video.description) return "";
  return `<div class="dashboard-gb-video-desc">${escapeAttr(video.description)}</div>`;
}

function openVideoAttrs(video: GbVideo, referenceDate: string): string {
  return `href="${escapeAttr(video.url)}" target="_blank" rel="noopener noreferrer" data-action="gb-open-video" data-cid="${escapeAttr(video.cid)}" data-url="${escapeAttr(video.url)}" data-date="${escapeAttr(referenceDate)}"`;
}

function nextVideoCard(
  video: GbVideo,
  track: GbTrack,
  revealed: Record<string, string>,
  referenceDate: string,
): string {
  const label = track === "gb1" ? "GB1" : "GB2";
  const showDesc = Boolean(revealed[video.cid]);
  return `<a class="dashboard-gb-next-card external-link" ${openVideoAttrs(video, referenceDate)} title="Open next ${label} video">
  ${thumbImg(video.thumbnailUrl, "dashboard-gb-next-thumb", video.title)}
  <div class="dashboard-gb-next-body">
    <div class="dashboard-gb-next-label">Next ${label}</div>
    <div class="dashboard-gb-next-title">${escapeAttr(video.title)}</div>
    ${descriptionBlock(video, showDesc)}
    ${!showDesc && video.description ? `<div class="dashboard-gb-video-hint">Tap to open · technique prompt appears here</div>` : ""}
  </div>
</a>`;
}

function videoRow(
  video: GbVideo,
  watched: boolean,
  watchedDate: string | undefined,
  revealed: Record<string, string>,
  referenceDate: string,
): string {
  const mark = watched ? "✓" : "○";
  const cls = watched ? " is-watched" : "";
  const showDesc = Boolean(revealed[video.cid]);
  return `<li class="dashboard-gb-video${cls}">
  <button type="button" class="dashboard-gb-video-toggle" data-action="gb-toggle-watched" data-cid="${escapeAttr(video.cid)}" data-date="${escapeAttr(referenceDate)}" title="${watched ? "Mark unwatched" : "Mark watched (after you recall the technique)"}">${mark}</button>
  ${thumbImg(video.thumbnailUrl, "dashboard-gb-video-thumb", video.title)}
  <div class="dashboard-gb-video-main">
    <a ${openVideoAttrs(video, referenceDate)} class="dashboard-gb-video-link external-link">${escapeAttr(video.title)}</a>
    ${descriptionBlock(video, showDesc)}
  </div>
  ${watchedDate ? `<span class="dashboard-gb-video-date">${escapeAttr(watchedDate)}</span>` : ""}
</li>`;
}

function videoList(
  videos: GbVideo[],
  track: GbTrack,
  watched: Record<string, string>,
  revealed: Record<string, string>,
  referenceDate: string,
): string {
  const list = videos.filter((v) => v.track === track);
  if (!list.length) return `<p class="dashboard-gb-empty">No ${track === "gb1" ? "GB1" : "GB2"} videos cached.</p>`;
  const items = list
    .map((v) => videoRow(v, Boolean(watched[v.cid]), watched[v.cid], revealed, referenceDate))
    .join("\n");
  return `<ul class="dashboard-gb-video-list">${items}</ul>`;
}

function trackSection(
  track: GbTrack,
  progress: GbTrackProgress,
  videos: GbVideo[],
  watched: Record<string, string>,
  revealed: Record<string, string>,
  referenceDate: string,
): string {
  const label = track === "gb1" ? "GB1" : "GB2";
  const countLabel = progress.total ? `${progress.done}/${progress.total} · ${progress.pct}%` : "—";
  const nextBlock = progress.nextVideo
    ? nextVideoCard(progress.nextVideo, track, revealed, referenceDate)
    : `<p class="dashboard-gb-all-done">${progress.total ? `All ${label} watched ✓` : `No ${label} videos`}</p>`;

  return `<section class="dashboard-gb-section" data-track="${track}">
  <div class="dashboard-gb-section-head">
    <span class="dashboard-gb-section-label">${label}</span>
    <span class="dashboard-gb-section-count">${countLabel}</span>
  </div>
  ${nextBlock}
  ${progressBar(progress.pct)}
  <details class="dashboard-gb-details">
    <summary>All ${label} videos (${progress.total})</summary>
    ${videoList(videos, track, watched, revealed, referenceDate)}
  </details>
</section>`;
}

export function buildGbOnlineWidgetHtml(model: GbOnlineWidgetModel): string {
  const {
    weekContext,
    referenceDate,
    fetchedAt,
    needsSync,
    gb1,
    gb2,
    videos,
    watched,
    revealed,
    error,
  } = model;

  if (error) {
    return `<div class="dashboard-widget dashboard-gb-online dashboard-gb-prototype" data-widget="gb-online-prototype" data-context-date="${escapeAttr(referenceDate)}">
  <p class="dashboard-gb-error">${escapeAttr(error)}</p>
  <button type="button" class="dashboard-gb-sync-btn" data-action="gb-sync" data-date="${escapeAttr(referenceDate)}">Sync curriculum</button>
</div>`;
  }

  if (!weekContext) {
    return `<div class="dashboard-widget dashboard-gb-online dashboard-gb-prototype" data-widget="gb-online-prototype" data-context-date="${escapeAttr(referenceDate)}">
  <p class="dashboard-gb-error">No GB week found. Add <code>GB Week:</code> to this note or the current weekly note.</p>
</div>`;
  }

  const synced = fetchedAt ? new Date(fetchedAt).toLocaleString() : "never";
  const staleNote = needsSync ? ` · <span class="dashboard-gb-stale">sync recommended</span>` : "";
  const header = `<div class="dashboard-gb-header">
  <div class="dashboard-gb-title">GBOnline Prototype · Week ${weekContext.weekNum}</div>
  <div class="dashboard-gb-meta">Synced ${escapeAttr(synced)}${staleNote}</div>
  <div class="dashboard-gb-actions">
    <button type="button" class="dashboard-gb-sync-btn" data-action="gb-sync" data-date="${escapeAttr(referenceDate)}">Sync</button>
    <button type="button" class="dashboard-gb-week-btn" data-action="gb-open-week" data-date="${escapeAttr(referenceDate)}">Open week</button>
  </div>
</div>`;

  const sections = `${trackSection("gb1", gb1, videos, watched, revealed, referenceDate)}
${trackSection("gb2", gb2, videos, watched, revealed, referenceDate)}`;

  return `<div class="dashboard-widget dashboard-gb-online dashboard-gb-prototype" data-widget="gb-online-prototype" data-context-date="${escapeAttr(referenceDate)}" data-week="${weekContext.weekNum}">
  ${header}
  <div class="dashboard-gb-sections">${sections}</div>
</div>`;
}
