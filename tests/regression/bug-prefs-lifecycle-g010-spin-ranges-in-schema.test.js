import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AppearancePage } from "../../lib/prefs/appearance.js";
import { KeyboardPage } from "../../lib/prefs/keyboard.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * prefs-lifecycle:G010: only stacked-tab-bar-height had a <range> in the gschema, while
 * every other numeric key is bound to a spin button with its own limits. A hand-set or
 * imported value outside the spin limits reached the layout raw, and GSettings pushed it
 * into the spin button.
 *
 * Fix: each spin-bound key carries a <range> equal to its spin button's low and high.
 * The mocks do not model ranges, so the schema is parsed off disk and compared with the
 * range each bound spin button was built with.
 */
const GSCHEMA = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schemas",
  "org.gnome.shell.extensions.forge.gschema.xml"
);

function schemaRanges() {
  const xml = readFileSync(GSCHEMA, "utf8");
  const main =
    /<schema\b[^>]*\bid="org\.gnome\.shell\.extensions\.forge"[^>]*>([\s\S]*?)<\/schema>/.exec(
      xml
    )[1];
  const ranges = new Map();
  for (const [, name, body] of main.matchAll(
    /<key\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/key>/g
  )) {
    const r = /<range\s+min="(\d+)"\s+max="(\d+)"/.exec(body);
    ranges.set(name, r ? [Number(r[1]), Number(r[2])] : null);
  }
  return ranges;
}

afterEach(() => vi.restoreAllMocks());

describe("prefs-lifecycle:G010: spin-bound keys carry their spin range in the schema", () => {
  it("every key bound to a spin button has a schema range equal to the spin range", () => {
    vi.spyOn(File.prototype, "load_contents").mockImplementation(() => [
      true,
      new TextEncoder().encode(".window-tiled-border { border-width: 3px; }"),
      null,
    ]);
    const settings = new Settings();
    settings.set_uint("css-last-update", 0);
    const spins = new Map();
    const realBind = settings.bind.bind(settings);
    vi.spyOn(settings, "bind").mockImplementation((key, obj, prop, flags) => {
      if ("_low" in obj) spins.set(key, [obj._low, obj._high]);
      return realBind(key, obj, prop, flags);
    });
    const dir = new File("/mock");
    new AppearancePage({ settings, dir });
    new KeyboardPage({ settings, kbdSettings: new Settings() });

    expect(spins.has("resize-amount")).toBe(true);
    expect(spins.size).toBeGreaterThanOrEqual(9);
    const ranges = schemaRanges();
    for (const [key, spin] of spins) {
      expect({ key, schema: ranges.get(key) }).toEqual({ key, schema: spin });
    }
  });
});
