export type WikiBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "ordered"; index: number; text: string }
  | { kind: "image"; alt: string; url: string }
  | { kind: "code"; text: string };

/** Dependency-free Markdown subset for the mobile Wiki surface. */
export function parseWikiBlocks(source: string): WikiBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: WikiBlock[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;
  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (code) { blocks.push({ kind: "code", text: code.join("\n") }); code = null; }
      else { flushParagraph(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    const trimmed = line.trim();
    if (!trimmed) { flushParagraph(); continue; }
    const image = trimmed.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/);
    if (image) { flushParagraph(); blocks.push({ kind: "image", alt: image[1], url: image[2] }); continue; }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { flushParagraph(); blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] }); continue; }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) { flushParagraph(); blocks.push({ kind: "bullet", text: bullet[1] }); continue; }
    const ordered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) { flushParagraph(); blocks.push({ kind: "ordered", index: Number(ordered[1]), text: ordered[2] }); continue; }
    paragraph.push(trimmed);
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  flushParagraph();
  return blocks;
}

export type WikiInlinePart = { text: string; url?: string; strong?: boolean };

export function splitWikiInline(text: string): WikiInlinePart[] {
  const parts: WikiInlinePart[] = [];
  const pattern = /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: text.slice(cursor, index) });
    if (match[1] !== undefined) parts.push({ text: match[1], url: match[2] });
    else parts.push({ text: match[3] ?? match[4] ?? "", strong: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts.length ? parts : [{ text }];
}
