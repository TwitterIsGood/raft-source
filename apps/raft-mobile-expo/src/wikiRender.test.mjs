import test from "node:test";
import assert from "node:assert/strict";
import { isSafeWikiUrl, parseWikiBlocks, resolveWikiAssetUrl, splitWikiInline } from "./wikiRender.ts";

test("wiki markdown keeps headings, links, images and code as structured blocks", () => {
  const blocks = parseWikiBlocks("# Title\n\nSee **bold** [docs](https://example.com) and [inside](/wiki/inside).\n\n![diagram](https://example.com/a.png)\n\n1. first\n2. second\n\n```ts\nconst x = 1\n```");
  assert.deepEqual(blocks.map((block) => block.kind), ["heading", "paragraph", "image", "ordered", "ordered", "code"]);
  assert.equal(blocks[2].url, "https://example.com/a.png");
  assert.equal(blocks[5].text, "const x = 1");
  assert.deepEqual(splitWikiInline("See [docs](https://example.com)."), [
    { text: "See " }, { text: "docs", url: "https://example.com" }, { text: "." },
  ]);
  assert.deepEqual(splitWikiInline("**bold** [inside](/wiki/inside)"), [
    { text: "bold", strong: true }, { text: " " }, { text: "inside", url: "/wiki/inside" },
  ]);
});

test("wiki markdown accepts safe relative links and images and resolves image assets", () => {
  const blocks = parseWikiBlocks("![relative](assets/blue.png)\n\n[page](docs/start)\n\n![root](/uploads/a.png)");
  assert.deepEqual(blocks.map((block) => block.kind), ["image", "paragraph", "image"]);
  assert.equal(blocks[0].url, "assets/blue.png");
  assert.deepEqual(splitWikiInline("[page](docs/start)"), [{ text: "page", url: "docs/start" }]);
  assert.equal(resolveWikiAssetUrl("assets/blue.png", "http://127.0.0.1:13074"), "http://127.0.0.1:13074/assets/blue.png");
  assert.equal(isSafeWikiUrl("javascript:alert(1)"), false);
  assert.equal(splitWikiInline("[unsafe](javascript:evil)")[0].text, "[unsafe](javascript:evil)");
  assert.equal(resolveWikiAssetUrl("//evil.example/a.png", "http://127.0.0.1:13074"), "");
});
