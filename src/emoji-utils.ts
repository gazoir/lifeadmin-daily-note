const LEADING_EMOJI_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u;

export function splitLeadingEmoji(text: string): { emoji: string; rest: string } {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(LEADING_EMOJI_RE);
  if (!match) return { emoji: "", rest: trimmed };
  return { emoji: match[1], rest: trimmed.slice(match[0].length).trim() };
}

export function firstEmojiChar(value: string): string {
  return splitLeadingEmoji(value).emoji;
}
