import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Small JSON state files outside dist/ (the 67 counter and its idle game), so
// restarts and rebuilds keep them.

/**
 * Read a state file. Missing: `fallback()`. Unparsable or rejected by `parse`:
 * moved aside to `<file>.corrupt-<time>`, then `fallback()`. Present but
 * unreadable: throw, refusing to start rather than overwrite it later.
 */
export function loadJsonFile<T>(file: string, parse: (raw: unknown) => T | null, fallback: () => T, label: string): T {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback();
    throw err;
  }
  try {
    const value = parse(JSON.parse(text));
    if (value !== null) return value;
  } catch {
    // fall through
  }
  const backup = `${file}.corrupt-${Date.now()}`;
  renameSync(file, backup);
  console.error(`${label}: ${file} was corrupt, moved to ${backup}; starting fresh`);
  return fallback();
}

/** Write atomically (tmp file + rename); log instead of throwing. */
export function saveJsonFile(file: string, data: unknown, label: string): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { flush: true });
    renameSync(tmp, file);
  } catch (err) {
    console.error(`${label}: could not save`, err);
  }
}

/** Calls `save` at most once per `delayMs`; `flush()` saves right away if needed. */
export function debouncedSaver(save: () => void, delayMs: number): { schedule(): void; flush(): void } {
  let timer: NodeJS.Timeout | null = null;
  let dirty = false;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (dirty) {
      dirty = false;
      save();
    }
  };
  return {
    schedule() {
      dirty = true;
      timer ??= setTimeout(flush, delayMs);
    },
    flush,
  };
}
