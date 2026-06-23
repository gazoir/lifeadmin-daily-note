export interface HevyLogEntry {
  id: string;
  time?: string;
  name?: string;
  volume?: number;
}

function unquoteYaml(v: string): string {
  const s = String(v ?? "").trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    const inner = s.slice(1, -1);
    return inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return s;
}

export function parseHevyWorkoutsFromMarkdown(md: string): HevyLogEntry[] {
  const text = md.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return [];
  const fmEnd = text.indexOf("\n---\n", 4);
  if (fmEnd === -1) return [];

  const lines = text.slice(0, fmEnd + 5).split("\n");
  const endFence = lines.indexOf("---", 1);
  if (endFence === -1) return [];
  const inner = lines.slice(1, endFence);
  const idx = inner.findIndex((l) => /^hevy_workouts:\s*$/.test(l));
  if (idx === -1) return [];

  const items: HevyLogEntry[] = [];
  let cur: HevyLogEntry | null = null;
  for (let i = idx + 1; i < inner.length; i++) {
    const line = inner[i];
    if (/^[A-Za-z0-9_ -]+:\s*$/.test(line) && !/^\s/.test(line)) break;
    if (!/^\s/.test(line) && line.trim() !== "") break;
    const mItem = line.match(/^\s*-\s+id:\s*(.+)\s*$/);
    if (mItem) {
      if (cur) items.push(cur);
      cur = { id: unquoteYaml(mItem[1]) };
      continue;
    }
    if (!cur) continue;
    const mKV = line.match(/^\s{4}([a-zA-Z0-9_]+):\s*(.+)\s*$/);
    if (!mKV) continue;
    const key = mKV[1];
    const val = mKV[2];
    if (key === "time" || key === "name") (cur as Record<string, unknown>)[key] = unquoteYaml(val);
    else if (key === "volume") cur.volume = Number(val);
  }
  if (cur) items.push(cur);
  return items.filter((x) => x?.id);
}
