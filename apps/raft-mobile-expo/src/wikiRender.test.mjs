import test from "node:test";
import assert from "node:assert/strict";
import { parseWikiBlocks, splitWikiInline } from "./wikiRender.ts";

test("wiki markdown keeps headings, links, images and code as structured blocks", () => {
  const blocks = parseWikiBlocks("# Title\n\nSee [docs](https://example.com).\n\n![diagram](https://example.com/a.png)\n\n```ts\nconst x = 1\n```");
  assert.deepEqual(blocks.map((block) => block.kind), ["heading", "paragraph", "image", "code"]);
  assert.equal(blocks[2].url, "https://example.com/a.png");
  assert.equal(blocks[3].text, "const x = 1");
  assert.deepEqual(splitWikiInline("See [docs](https://example.com)."), [
    { text: "See " }, { text: "docs", url: "https://example.com" }, { text: "." },
  ]);
});
