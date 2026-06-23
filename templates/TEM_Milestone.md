<%*
const dv = app.plugins.plugins["dataview"]?.api;
if (!dv) {
  tR += "no upcoming project";
  return;
}

const title = String(tp.file.title ?? "").trim();
const refYmd = /^\d{4}-\d{2}-\d{2}$/.test(title) ? title : moment().format("YYYY-MM-DD");
const ref = dv.date(refYmd);

const blockedTags = new Set(["complete", "ongoing", "cancelled"]);

const hasBlockedTag = (p) => {
  for (const tag of p.file.etags ?? []) {
    if (blockedTags.has(String(tag).replace(/^#/, "").toLowerCase())) return true;
  }
  const tags = p.tags;
  const list = Array.isArray(tags) ? tags : tags ? [tags] : [];
  for (const tag of list) {
    if (blockedTags.has(String(tag).toLowerCase())) return true;
  }
  return false;
};

const isExcludedPath = (path) =>
  path.startsWith("Templates/") ||
  path.includes("/Templates/") ||
  path.startsWith("Diaries/") ||
  path.startsWith("Archive/") ||
  path.includes("/Archive/");

const next = dv
  .pages("#project")
  .where((p) => {
    if (!p.date || hasBlockedTag(p) || isExcludedPath(p.file.path)) return false;
    const eventDate = dv.date(p.date);
    return eventDate && eventDate >= ref;
  })
  .sort((p) => p.date, "asc")[0];

if (!next) {
  tR += "no upcoming project";
  return;
}

const linkPath = next.file.path.replace(/\.md$/i, "");
const label = next.file.name.replace(/\.md$/i, "");
const daysDiff = Math.floor(dv.date(next.date).diff(ref, "days").days);

let when = `in ${daysDiff} days`;
if (daysDiff === 0) when = "today";
else if (daysDiff === 1) when = "tomorrow";

tR += `[[${linkPath}|${label}]] ${when}`;
%>
