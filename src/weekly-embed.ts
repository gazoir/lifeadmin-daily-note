import { DAILY_NOTE_PATH_RE } from "./daily-notes";

const WEEKLY_EMBED_RE = /-W\d{1,2}/i;

function weeklyEmbedHasNotes(content: HTMLElement): boolean {
  if (content.querySelector("ul li, ol li, .task-list-item, pre, table")) return true;

  const clone = content.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("h1, h2, h3, h4, h5, h6, .markdown-embed-title, .embed-title, .embed-link")
    .forEach((node) => node.remove());

  return (clone.textContent ?? "").replace(/\s+/g, "").length > 0;
}

function isWeeklyDayEmbed(embed: HTMLElement): boolean {
  const src = embed.getAttribute("src") ?? embed.dataset.src ?? "";
  const title =
    embed.querySelector(".markdown-embed-title, .embed-title")?.textContent ??
    embed.getAttribute("alt") ??
    "";
  return WEEKLY_EMBED_RE.test(`${src} ${title}`);
}

export function processWeeklyDayEmbeds(root: HTMLElement): void {
  const embeds = root.querySelectorAll<HTMLElement>(".internal-embed, .markdown-embed");
  for (const embed of embeds) {
    if (!isWeeklyDayEmbed(embed)) continue;

    embed.classList.add("lifeadmin-weekly-day-embed");
    const body =
      embed.querySelector<HTMLElement>(".markdown-embed-content, .embed-content, .markdown-preview-view") ?? embed;
    const hasNotes = weeklyEmbedHasNotes(body);
    embed.classList.toggle("lifeadmin-weekly-embed-empty", !hasNotes);
  }
}

export function scheduleWeeklyDayEmbedPass(root: HTMLElement): void {
  processWeeklyDayEmbeds(root);
  for (const ms of [80, 250, 600, 1200]) {
    window.setTimeout(() => processWeeklyDayEmbeds(root), ms);
  }
}

export function isDailyNotePath(path: string): boolean {
  return DAILY_NOTE_PATH_RE.test(path);
}
