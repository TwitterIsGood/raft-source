import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectBuildOutput, ISOLATED_API_URL } from "./verify-isolated-build.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configured = process.env.EXPO_PUBLIC_RAFT_API_URL;
if (configured !== ISOLATED_API_URL) {
  console.error(`isolated-export: set EXPO_PUBLIC_RAFT_API_URL=${ISOLATED_API_URL} before exporting`);
  process.exit(2);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, ["expo", "export", "--platform", "ios"], {
  cwd: appRoot,
  env: { ...process.env, EXPO_PUBLIC_RAFT_API_URL: configured },
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const output = path.join(appRoot, "dist");
const evidence = inspectBuildOutput(output, configured);
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  apiBaseUrl: configured,
  output,
  ...evidence,
}, null, 2));
if (!evidence.ok) process.exit(1);
