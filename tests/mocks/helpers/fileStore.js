/**
 * In-memory file store for the mocked Gio.File.
 *
 * Spies on File.prototype so the real ConfigManager getter, fallback and setter
 * run against a path-keyed map. Call vi.restoreAllMocks() in afterEach.
 */
import { vi } from "vitest";
import { File } from "../gnome/Gio.js";

/**
 * @param {Record<string, string>} [seed] - path to file text
 * @returns {{ files: Map<string, string>, failWrites: (fail?: boolean) => void }}
 */
export function installFileStore(seed = {}) {
  const files = new Map(Object.entries(seed));
  let failing = false;

  vi.spyOn(File.prototype, "query_exists").mockImplementation(function () {
    // Anything without an extension is a directory the code may create or probe.
    return files.has(this.path) || !this.path.endsWith(".json");
  });
  vi.spyOn(File.prototype, "load_contents").mockImplementation(function () {
    if (!files.has(this.path)) throw new Error(`no such file: ${this.path}`);
    return [true, new TextEncoder().encode(files.get(this.path)), null];
  });
  vi.spyOn(File.prototype, "replace_contents").mockImplementation(function (contents) {
    if (failing) throw new Error(`write failed: ${this.path}`);
    files.set(this.path, new TextDecoder().decode(contents));
    return [true, null];
  });

  return { files, failWrites: (fail = true) => (failing = fail) };
}
