// Run every games/**/*.test.ts and tests/**/*.test.mts with Node's test runner (TypeScript via tsx).
// A script instead of a shell glob so it works the same on Windows, macOS and
// Linux, and also finds tests in subfolders like games/<id>/tests/.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SKIP = new Set(["node_modules", "dist", "test-results"]);

function findTests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : findTests(path);
    return /\.test\.(ts|mts)$/.test(entry.name) ? [path] : [];
  });
}

const files = [...findTests("games"), ...findTests("tests")];
const { status } = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
});
process.exit(status ?? 1);
