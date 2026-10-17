// close-spec-gaps:N05: ConfigSync._setSettingValue built new GLib.Variant(typeString, value)
// from the raw JSON value. GJS throws for ('u', "abc") and ('u', -1): the throw left
// _importSettingsCategory, so importSettings dropped every later key and logged no
// "Import rejected <key>". GJS coerces ('b', "false") to true, so a wrong type could also land
// as another value. importKeybindings passed a non-string to set_string and set_strv alike.
// Fix: the JSON value is checked against the key's type string before any write (a uint32 for
// u, a boolean for b, a string for s, an array of strings for as); a mismatch is a rejected key.
import { describe, it, expect, vi, afterEach } from "vitest";
import GLib from "gi://GLib";
import { ConfigSync } from "../../lib/shared/config-sync.js";
import { Logger } from "../../lib/shared/logger.js";
import { Settings } from "../mocks/gnome/Gio.js";

afterEach(() => vi.restoreAllMocks());

function setup({ settingsProps, keybindingsProps }) {
  const settings = new Settings();
  settings.set_boolean("tiling-mode-enabled", false);
  settings.set_boolean("auto-split-enabled", false);
  settings.set_string("default-window-layout", "tiled");
  settings.set_uint("window-gap-size", 4);
  settings.set_uint("window-margin-top", 0);
  settings.set_uint("window-margin-left", 0);
  settings.set_uint("resize-amount", 15);
  const kbdSettings = new Settings();
  kbdSettings.set_string("mod-mask-mouse-tile", "None");
  kbdSettings.set_strv("window-focus-left", ["<Super>h"]);
  kbdSettings.set_strv("window-focus-right", ["<Super>l"]);
  const configMgr = { settingsProps, keybindingsProps };
  const sync = new ConfigSync({ configMgr, settings, kbdSettings });
  const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {});
  // A vitest 2 spy calls a class without new, so it delegates.
  const Variant = GLib.Variant;
  const variant = vi.spyOn(GLib, "Variant").mockImplementation((t, v) => new Variant(t, v));
  return { sync, settings, kbdSettings, warn, variant };
}

const rejected = (warn) => warn.mock.calls.map(([msg]) => msg);

describe("a wrong-typed import value is rejected per key", () => {
  it("settings: each wrong type is rejected, the later keys land, the import is partial", () => {
    const { sync, settings, warn, variant } = setup({
      settingsProps: {
        behavior: {
          "tiling-mode-enabled": "false",
          "auto-split-enabled": true,
          "default-window-layout": 5,
        },
        appearance: { "window-gap-size": "abc", "window-margin-top": -1, "window-margin-left": 6 },
        other: { "resize-amount": 30 },
      },
    });

    expect(sync.importAll()).toMatchObject({ settings: false, applied: 3 });
    expect(rejected(warn)).toEqual([
      "Import rejected tiling-mode-enabled",
      "Import rejected default-window-layout",
      "Import rejected window-gap-size",
      "Import rejected window-margin-top",
    ]);
    expect(settings.get_boolean("tiling-mode-enabled")).toBe(false);
    expect(settings.get_string("default-window-layout")).toBe("tiled");
    expect(settings.get_uint("window-gap-size")).toBe(4);
    expect(settings.get_uint("window-margin-top")).toBe(0);
    expect(settings.get_boolean("auto-split-enabled")).toBe(true);
    expect(settings.get_uint("window-margin-left")).toBe(6);
    expect(settings.get_uint("resize-amount")).toBe(30);
    // Rejected before the variant is built, whatever the mock's coercion does.
    expect(variant.mock.calls.map(([type, value]) => [type, value])).toEqual([
      ["b", true],
      ["u", 6],
      ["u", 30],
    ]);
    sync.destroy();
  });

  it("keybindings: a non-string value is rejected, the later binding lands", () => {
    const { sync, kbdSettings, warn } = setup({
      keybindingsProps: {
        "mod-mask-mouse-tile": 5,
        bindings: { "window-focus-left": ["<Super>h", 5], "window-focus-right": ["<Super>k"] },
      },
    });

    expect(sync.importAll()).toMatchObject({ keybindings: false, applied: 1 });
    expect(rejected(warn)).toEqual([
      "Import rejected mod-mask-mouse-tile",
      "Import rejected window-focus-left",
    ]);
    expect(kbdSettings.get_string("mod-mask-mouse-tile")).toBe("None");
    expect(kbdSettings.get_strv("window-focus-left")).toEqual(["<Super>h"]);
    expect(kbdSettings.get_strv("window-focus-right")).toEqual(["<Super>k"]);
    sync.destroy();
  });
});
