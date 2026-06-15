<%*
const filePath = "Z_Personal admin/Domestic God/🩺 Health/🥋 BJJ/BJJ Curriculum.md";
const watchlistHeading = "Watchlist";
const viewedHeading = "Viewed";

const file = app.vault.getAbstractFileByPath(filePath);

if (!file) {
  throw new Error(`Could not find file: ${filePath}`);
}

let content = await app.vault.read(file);
let lines = content.split("\n");

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headingRegex(heading) {
  return new RegExp(`^#\\s+${escapeRegex(heading)}\\s*$`);
}

function findHeadingIndex(lines, heading) {
  const re = headingRegex(heading);
  return lines.findIndex(line => re.test(line.trim()));
}

function findSectionEnd(lines, startIndex) {
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^#\s+/.test(lines[i].trim())) {
      return i;
    }
  }
  return lines.length;
}

// Accepts either:
// [Title](url)
// - [Title](url)
// * [Title](url)
function isTutorialLine(line) {
  const trimmed = line.trim();
  return /^(?:[-*]\s+)?\[.+?\]\(.+?\)\s*$/.test(trimmed);
}

function normalizeTutorialLine(line) {
  return line
    .trim()
    .replace(/^[-*]\s+/, "")
    .trim();
}

// Preserve your file style: plain markdown links, not bullet list items
function asStoredTutorialLine(tutorialLine) {
  return normalizeTutorialLine(tutorialLine);
}

function cleanSectionSectionLines(sectionLines) {
  // Keeps non-tutorial lines, comments, and spacing intact.
  // This function exists mostly as a named placeholder in case you later want stricter cleanup.
  return sectionLines;
}

// Find sections
let watchlistStart = findHeadingIndex(lines, watchlistHeading);
let viewedStart = findHeadingIndex(lines, viewedHeading);

if (watchlistStart === -1) {
  throw new Error(`# ${watchlistHeading} heading not found`);
}

if (viewedStart === -1) {
  throw new Error(`# ${viewedHeading} heading not found`);
}

let watchlistEnd = findSectionEnd(lines, watchlistStart);
let viewedEnd = findSectionEnd(lines, viewedStart);

let watchlistSection = lines.slice(watchlistStart + 1, watchlistEnd);
let viewedSection = lines.slice(viewedStart + 1, viewedEnd);

watchlistSection = cleanSectionSectionLines(watchlistSection);
viewedSection = cleanSectionSectionLines(viewedSection);

let watchlistTutorials = watchlistSection.filter(isTutorialLine);
let viewedTutorials = viewedSection.filter(isTutorialLine);

// If Watchlist is empty, move all Viewed tutorials back to Watchlist
if (watchlistTutorials.length === 0) {
  if (viewedTutorials.length === 0) {
    throw new Error(`# ${watchlistHeading} and # ${viewedHeading} are both empty`);
  }

  const viewedTutorialSet = new Set(viewedTutorials.map(normalizeTutorialLine));

  watchlistSection = [
    "",
    ...viewedTutorials.map(asStoredTutorialLine),
    ""
  ];

  viewedSection = viewedSection.filter(line => {
    if (!isTutorialLine(line)) return true;
    return !viewedTutorialSet.has(normalizeTutorialLine(line));
  });

  watchlistTutorials = watchlistSection.filter(isTutorialLine);
}

// Pick random tutorial from Watchlist
const pickedOriginalLine =
  watchlistTutorials[Math.floor(Math.random() * watchlistTutorials.length)];

const pickedTutorial = normalizeTutorialLine(pickedOriginalLine);

// Remove picked tutorial from Watchlist
let removedOne = false;

watchlistSection = watchlistSection.filter(line => {
  if (
    !removedOne &&
    isTutorialLine(line) &&
    normalizeTutorialLine(line) === pickedTutorial
  ) {
    removedOne = true;
    return false;
  }

  return true;
});

// Add picked tutorial to Viewed
const viewedInsertLine = asStoredTutorialLine(pickedTutorial);

if (viewedSection.length === 0 || viewedSection.every(line => line.trim() === "")) {
  viewedSection = ["", viewedInsertLine, ""];
} else {
  if (viewedSection[0]?.trim() !== "") {
    viewedSection.unshift("");
  }

  if (viewedSection[viewedSection.length - 1]?.trim() === "") {
    viewedSection.splice(viewedSection.length - 1, 0, viewedInsertLine);
  } else {
    viewedSection.push(viewedInsertLine);
  }
}

// Rebuild file.
// Important: edit the lower section first if needed? Safer approach:
// Replace Watchlist, then recalculate Viewed because line numbers may shift.

lines = content.split("\n");

watchlistStart = findHeadingIndex(lines, watchlistHeading);
watchlistEnd = findSectionEnd(lines, watchlistStart);

lines.splice(
  watchlistStart + 1,
  watchlistEnd - watchlistStart - 1,
  ...watchlistSection
);

// Recalculate Viewed after Watchlist edit
viewedStart = findHeadingIndex(lines, viewedHeading);
viewedEnd = findSectionEnd(lines, viewedStart);

lines.splice(
  viewedStart + 1,
  viewedEnd - viewedStart - 1,
  ...viewedSection
);

await app.vault.modify(file, lines.join("\n"));

// Output task
const today = tp.date.now("YYYY-MM-DD");
tR += `- [ ] 🥋 ${pickedTutorial} 📅 ${today} 🔺`;
%>
