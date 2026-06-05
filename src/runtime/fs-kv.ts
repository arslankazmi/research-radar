import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { KvStore } from "../contracts.js";

/**
 * KvStore backed by JSON files on the local filesystem.
 * Each key maps to `<dir>/<key>.json`.
 * The directory is created (mkdir -p) on first write.
 */
export function fsKv(dir: string): KvStore {
  async function keyPath(key: string): Promise<string> {
    // Sanitize key to be a safe filename
    const safe = key.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return join(dir, `${safe}.json`);
  }

  return {
    async read<T>(key: string): Promise<T | undefined> {
      const path = await keyPath(key);
      try {
        const contents = await readFile(path, "utf-8");
        return JSON.parse(contents) as T;
      } catch (err: unknown) {
        if (typeof err === "object" && err !== null && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw err;
      }
    },

    async write<T>(key: string, value: T): Promise<void> {
      // Ensure directory exists (mkdir -p)
      await mkdir(dir, { recursive: true });
      const path = await keyPath(key);
      await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
    },
  };
}
