import fs from "node:fs";
import path from "node:path";

export const ISOLATED_API_URL = "http://127.0.0.1:13074";
export const PRODUCTION_API_URL = "https://bj1.v.lhb.ink:63204";

function fail(message) {
  console.error(`isolated-build: ${message}`);
  process.exitCode = 1;
  return false;
}

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop();
    if (!current) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) queue.push(path.join(current, entry));
    } else if (stat.isFile()) {
      result.push(current);
    }
  }
  return result;
}

export function inspectBuildOutput(root, configured = process.env.EXPO_PUBLIC_RAFT_API_URL) {
  if (configured !== ISOLATED_API_URL) {
    return { ok: false, reason: `EXPO_PUBLIC_RAFT_API_URL must equal ${ISOLATED_API_URL}` };
  }
  if (!fs.existsSync(root)) return { ok: false, reason: `build output does not exist: ${root}` };

  let localHits = 0;
  const productionFiles = [];
  for (const file of filesUnder(root)) {
    const text = fs.readFileSync(file).toString("utf8");
    if (text.includes(ISOLATED_API_URL)) localHits += 1;
    if (text.includes(PRODUCTION_API_URL)) productionFiles.push(path.relative(root, file));
  }
  return {
    ok: localHits > 0 && productionFiles.length === 0,
    configured,
    localHits,
    productionFiles,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(process.argv[2] ?? "dist");
  const result = inspectBuildOutput(root);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    output: root,
    ...result,
  }, null, 2));
  if (!result.ok) fail(result.reason ?? `production URL found in: ${result.productionFiles?.join(", ")}`);
}
