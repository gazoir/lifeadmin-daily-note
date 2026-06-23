<%*
async function pickTodayIAmLine() {
  const file = app.metadataCache.getFirstLinkpathDest("Today I am", "");
  if (!file) return "present";
  const lines = (await app.vault.read(file))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[Math.floor(Math.random() * lines.length)] || "present";
}

const [start, mid, end] = await Promise.all([pickTodayIAmLine(), pickTodayIAmLine(), pickTodayIAmLine()]);
tR += `> [!todayiam] *[Today I am ${start}, ${mid} and ${end}.](obsidian://open?vault=%F0%9F%94%90%20Diaries&file=Diaries)*\n`;
%>
