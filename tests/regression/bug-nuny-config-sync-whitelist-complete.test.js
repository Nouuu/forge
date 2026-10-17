import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SETTINGS_KEYS,
  KEYBINDING_STRING_KEYS,
  bindingKeysOf,
} from "../../lib/shared/config-sync.js";

/**
 * Regression fence for forge-nuny / forge-eny3.
 *
 * The portable-config whitelists in config-sync.js (SETTINGS_KEYS,
 * KEYBINDING_STRING_KEYS) must stay in lock-step with the gschema, and the
 * keybinding set S-01 derives (bindingKeysOf: every 'as' key, sorted) must
 * equal the gschema's 'as' keys. Drift means silent data loss on export/import (a live key missing
 * from the whitelist is never written) or a dead decoy key that documents a
 * knob nothing reads. This test parses the gschema straight off disk and
 * asserts the whitelists are exactly the portable surface of each schema.
 *
 * theming-config:G003: it also pins config/settings.schema.json and
 * config/keybindings.schema.json to the same key sets and to the gschema ranges.
 */

// Main-schema keys that are deliberately NOT portable (internal bookkeeping /
// triggers). Everything else on the main schema MUST be whitelisted.
const INTERNAL_MAIN_KEYS = [
  "css-updated",
  "css-last-update",
  "window-overrides-reload-trigger",
  "config-last-import",
  "config-last-export",
  "config-file-sync-enabled",
  "gnome-overrides-originals",
];

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GSCHEMA_PATH = join(REPO_ROOT, "schemas", "org.gnome.shell.extensions.forge.gschema.xml");

const readJson = (name) => JSON.parse(readFileSync(join(REPO_ROOT, "config", name), "utf8"));
const HEADER_KEYS = ["$schema", "version"];

const MAIN_SCHEMA_ID = "org.gnome.shell.extensions.forge";
const KBD_SCHEMA_ID = "org.gnome.shell.extensions.forge.keybindings";

/**
 * Split the gschema XML into per-schema bodies keyed by schema id.
 * @returns {Map<string, string>}
 */
function readSchemaBodies() {
  const xml = readFileSync(GSCHEMA_PATH, "utf8");
  const bodies = new Map();
  // Match each <schema ...> ... </schema> block and capture its id.
  const schemaRe = /<schema\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/schema>/g;
  let m;
  while ((m = schemaRe.exec(xml)) !== null) {
    bodies.set(m[1], m[2]);
  }
  return bodies;
}

/**
 * Extract [{ name, type }] for every <key> in a schema body.
 * @param {string} body
 * @returns {Array<{name: string, type: string}>}
 */
function extractKeys(body) {
  const keyRe = /<key\b([^>]*)>/g;
  const keys = [];
  let m;
  while ((m = keyRe.exec(body)) !== null) {
    const attrs = m[1];
    const nameMatch = /\bname="([^"]+)"/.exec(attrs);
    const typeMatch = /\btype="([^"]+)"/.exec(attrs);
    if (nameMatch) {
      keys.push({ name: nameMatch[1], type: typeMatch ? typeMatch[1] : null });
    }
  }
  return keys;
}

/** Symmetric difference of two string arrays, sorted for a readable message. */
function symmetricDifference(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const onlyA = a.filter((x) => !setB.has(x)).sort();
  const onlyB = b.filter((x) => !setA.has(x)).sort();
  return { onlyA, onlyB };
}

describe("config-sync whitelist completeness (forge-nuny / forge-eny3)", () => {
  const bodies = readSchemaBodies();
  const mainKeys = extractKeys(bodies.get(MAIN_SCHEMA_ID));
  const kbdKeys = extractKeys(bodies.get(KBD_SCHEMA_ID));

  it("sanity: both schemas were parsed from disk", () => {
    expect(bodies.has(MAIN_SCHEMA_ID)).toBe(true);
    expect(bodies.has(KBD_SCHEMA_ID)).toBe(true);
    expect(mainKeys.length).toBeGreaterThan(0);
    expect(kbdKeys.length).toBeGreaterThan(0);
  });

  it("SETTINGS_KEYS exactly covers the portable main-schema keys", () => {
    const internal = new Set(INTERNAL_MAIN_KEYS);
    const expectedPortable = mainKeys
      .map((k) => k.name)
      .filter((name) => !internal.has(name))
      .sort();

    const flattened = Object.values(SETTINGS_KEYS).flat().sort();

    const { onlyA, onlyB } = symmetricDifference(flattened, expectedPortable);
    expect(
      onlyA.length === 0 && onlyB.length === 0,
      `SETTINGS_KEYS drifted from the gschema.\n` +
        `  In SETTINGS_KEYS but not portable gschema keys: ${JSON.stringify(onlyA)}\n` +
        `  Portable gschema keys missing from SETTINGS_KEYS: ${JSON.stringify(onlyB)}`
    ).toBe(true);
  });

  it("every internal main-schema key actually exists (no stale exclusions)", () => {
    const names = new Set(mainKeys.map((k) => k.name));
    for (const key of INTERNAL_MAIN_KEYS) {
      expect(names.has(key), `INTERNAL_MAIN_KEYS lists '${key}' but it is not in the gschema`).toBe(
        true
      );
    }
  });

  it("bindingKeysOf derives exactly the gschema's 'as' keys, sorted", () => {
    const asKeys = kbdKeys
      .filter((k) => k.type === "as")
      .map((k) => k.name)
      .sort();
    const types = new Map(kbdKeys.map((k) => [k.name, k.type]));
    const kbdSettings = {
      list_keys: () => kbdKeys.map((k) => k.name),
      get_default_value: (key) => ({ get_type_string: () => types.get(key) }),
    };

    expect(bindingKeysOf(kbdSettings)).toEqual(asKeys);
  });

  it("KEYBINDING_STRING_KEYS covers every non-'as' keybinding, and only those", () => {
    const stringKeys = kbdKeys
      .filter((k) => k.type !== "as")
      .map((k) => k.name)
      .sort();
    const whitelisted = [...KEYBINDING_STRING_KEYS].sort();

    const { onlyA, onlyB } = symmetricDifference(whitelisted, stringKeys);
    expect(
      onlyA.length === 0 && onlyB.length === 0,
      `KEYBINDING_STRING_KEYS drifted from the gschema string keys.\n` +
        `  In KEYBINDING_STRING_KEYS but not a string gschema key: ${JSON.stringify(onlyA)}\n` +
        `  String gschema keys missing from KEYBINDING_STRING_KEYS: ${JSON.stringify(onlyB)}`
    ).toBe(true);
  });

  describe("portable-config JSON schemas (theming-config:G003)", () => {
    const settingsJson = readJson("settings.schema.json");
    const kbdJson = readJson("keybindings.schema.json");
    const categories = Object.keys(settingsJson.properties).filter((k) => !HEADER_KEYS.includes(k));

    it("settings categories equal SETTINGS_KEYS categories", () => {
      expect(categories.sort()).toEqual(Object.keys(SETTINGS_KEYS).sort());
    });

    it("each settings category lists exactly its SETTINGS_KEYS", () => {
      for (const [cat, keys] of Object.entries(SETTINGS_KEYS)) {
        const props = Object.keys(settingsJson.properties[cat]?.properties ?? {});
        const { onlyA, onlyB } = symmetricDifference(props, keys);
        expect(
          onlyA.length === 0 && onlyB.length === 0,
          `settings.schema.json '${cat}' drifted.\n` +
            `  Only in JSON: ${JSON.stringify(onlyA)}\n  Only in SETTINGS_KEYS: ${JSON.stringify(
              onlyB
            )}`
        ).toBe(true);
      }
    });

    it("keybindings bindings equal the gschema 'as' keys", () => {
      const asKeys = kbdKeys.filter((k) => k.type === "as").map((k) => k.name);
      const { onlyA, onlyB } = symmetricDifference(
        Object.keys(kbdJson.properties.bindings.properties),
        asKeys
      );
      expect(
        onlyA.length === 0 && onlyB.length === 0,
        `keybindings.schema.json bindings drifted.\n` +
          `  Only in JSON: ${JSON.stringify(onlyA)}\n  Only in gschema: ${JSON.stringify(onlyB)}`
      ).toBe(true);
    });

    it("keybindings other properties equal KEYBINDING_STRING_KEYS", () => {
      const others = Object.keys(kbdJson.properties).filter(
        (k) => !HEADER_KEYS.includes(k) && k !== "bindings"
      );
      const { onlyA, onlyB } = symmetricDifference(others, [...KEYBINDING_STRING_KEYS]);
      expect(
        onlyA.length === 0 && onlyB.length === 0,
        `keybindings.schema.json string keys drifted.\n` +
          `  Only in JSON: ${JSON.stringify(
            onlyA
          )}\n  Only in KEYBINDING_STRING_KEYS: ${JSON.stringify(onlyB)}`
      ).toBe(true);
    });

    it("every main-schema <range> equals the JSON minimum and maximum", () => {
      const props = Object.assign(
        {},
        ...categories.map((c) => settingsJson.properties[c].properties)
      );
      const body = bodies.get(MAIN_SCHEMA_ID);
      const keyRe = /<key\b[^>]*\bname="([^"]+)"[^>]*>\s*<range\s+min="([^"]+)"\s+max="([^"]+)"/g;
      let m;
      let seen = 0;
      while ((m = keyRe.exec(body)) !== null) {
        seen++;
        const [, name, min, max] = m;
        expect(props[name], `'${name}' has a gschema range but no JSON property`).toBeDefined();
        expect([name, props[name].minimum, props[name].maximum]).toEqual([
          name,
          Number(min),
          Number(max),
        ]);
      }
      // A <range> that is not the key's first child would escape keyRe.
      expect(seen).toBe(body.match(/<range\b/g).length);
    });
  });
});
