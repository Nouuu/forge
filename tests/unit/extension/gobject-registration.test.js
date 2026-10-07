import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * S-03 guard: GObject.registerClass() throws at module load in real GJS when the
 * class's base is not a GObject class ("used with invalid base class"), and the unit
 * mocks cannot see it because registerClass is a no-op there. S-03a first dropped the
 * GObject base of ThemeManagerBase while ExtensionThemeManager still registered itself,
 * which would have broken enable() on every release.
 *
 * Rule checked on the sources: a registered class extends a GI or Shell class (a
 * dotted name such as GObject.Object or St.BoxLayout, or a name imported from gi:// or
 * resource:///), or another class that is itself registered.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "css" ? [] : jsFiles(path);
    return path.endsWith(".js") ? [path] : [];
  });
}

describe("S-03: GObject.registerClass needs a GObject base", () => {
  it("every registered class extends a GI/Shell class or a registered class", () => {
    const files = [
      ...jsFiles(join(ROOT, "lib")),
      join(ROOT, "extension.js"),
      join(ROOT, "prefs.js"),
    ];
    const classes = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const external = new Set();
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(?:gi|resource):\/\/[^"]*"/g))
        for (const name of m[1].split(","))
          external.add(
            name
              .trim()
              .split(/\s+as\s+/)
              .pop()
          );
      for (const m of src.matchAll(
        /class (\w+) extends ([\w.]+) \{\s*static \{\s*GObject\.registerClass\(/g
      ))
        classes.push({ file: file.slice(ROOT.length + 1), name: m[1], base: m[2], external });
    }
    const registered = new Set(classes.map((c) => c.name));
    const invalid = classes
      .filter(
        ({ base, external }) => !base.includes(".") && !external.has(base) && !registered.has(base)
      )
      .map(({ file, name, base }) => `${file}: ${name} extends ${base}`);

    expect(classes.length).toBeGreaterThan(0);
    expect(invalid).toEqual([]);
  });
});
