import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectBuildOutput, ISOLATED_API_URL, PRODUCTION_API_URL } from "../scripts/verify-isolated-build.mjs";

test("isolated build gate requires the isolated API and rejects production URLs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "raft-mobile-build-"));
  await fs.writeFile(path.join(root, "bundle.js"), `const api = ${JSON.stringify(ISOLATED_API_URL)};`);
  assert.equal(inspectBuildOutput(root, ISOLATED_API_URL).ok, true);
  assert.equal(inspectBuildOutput(root, undefined).ok, false);
  await fs.writeFile(path.join(root, "stale.js"), `const api = ${JSON.stringify(PRODUCTION_API_URL)};`);
  const result = inspectBuildOutput(root, ISOLATED_API_URL);
  assert.equal(result.ok, false);
  assert.deepEqual(result.productionFiles, ["stale.js"]);
  await fs.rm(root, { recursive: true, force: true });
});
