// prefs-lifecycle:G009: Reset saved the bundled default's overrides wholesale, but the page lists
// float rules only, so every tile rule (user-made or an edited default) vanished unseen.
// Fix: onResetHandler keeps the current non-float rules and replaces the float rules with the
// bundled default's float rules; $schema survives through saveOverrides (prefs-lifecycle:G012).
import { describe, it, expect, vi, afterEach } from "vitest";
import { FloatingPage } from "../../lib/prefs/floating.js";
import { File, Settings } from "../mocks/gnome/Gio.js";
import { installFileStore } from "../mocks/helpers/index.js";

const USER = "/home/test/.config/forge/config/windows.json";
const DEFAULT = "/mock/config/windows.json";
const SCHEMA = "https://example.test/windows.schema.json";

afterEach(() => vi.restoreAllMocks());

describe("Reset restores float rules and keeps tile rules", () => {
  it("keeps three tile rules, swaps float rules for the defaults, keeps $schema", () => {
    const userTile = { wmClass: "UserTile", mode: "tile" };
    const editedDefaultTile = { wmClass: "DefTile", mode: "tile", wmTitle: "edited" };
    const wmIdTile = { wmId: 7, mode: "tile" };
    const store = installFileStore({
      [USER]: JSON.stringify({
        $schema: SCHEMA,
        overrides: [{ wmClass: "UserFloat", mode: "float" }, userTile, editedDefaultTile, wmIdTile],
      }),
      [DEFAULT]: JSON.stringify({
        $schema: SCHEMA,
        overrides: [
          { wmClass: "DefTile", mode: "tile" },
          { wmClass: "DefFloatA", mode: "float" },
          { wmClass: "DefFloatB", mode: "float" },
        ],
      }),
    });
    const page = new FloatingPage({ settings: new Settings(), dir: new File("/mock") });
    page._root = { add_toast: () => {} };

    page.onResetHandler();

    const saved = JSON.parse(store.files.get(USER));
    expect(saved.$schema).toBe(SCHEMA);
    expect(saved.overrides).toEqual([
      userTile,
      editedDefaultTile,
      wmIdTile,
      { wmClass: "DefFloatA", mode: "float" },
      { wmClass: "DefFloatB", mode: "float" },
    ]);
    expect(page.rows).toHaveLength(2);
  });
});
