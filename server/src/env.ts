import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the repo-root .env (gitignored) into process.env, if it exists.
// Imported first by index.ts so later modules see the values at load time.
// Variables already set in the real environment win over the file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, "../../.env");

try {
  process.loadEnvFile(ENV_FILE);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
