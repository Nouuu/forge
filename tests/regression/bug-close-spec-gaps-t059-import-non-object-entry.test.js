// close-spec-gaps:T059: ConfigSync read props[category][key] and props.bindings[key] without
// checking that the category or the bindings value is an object. A string, number, array or
// null there yielded undefined for every key, so the whole entry was skipped with no
// "Import rejected" line and the file could still report success.
// Fix: a present category or bindings value that is not a plain object is a rejected entry,
// logged as "Import rejected <name>" with a false result. Unknown keys and unknown categories
// stay ignored (ruling R19: an export from another Forge version may carry keys this one lacks).
import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfigSync } from "../../lib/shared/config-sync.js";
import { Logger } from "../../lib/shared/logger.js";
import { Settings } from "../mocks/gnome/Gio.js";

afterEach(() => vi.restoreAllMocks());

function setup({ settingsProps, keybindingsProps }) {
  const settings = new Settings();
  settings.set_boolean("auto-split-enabled", false);
  settings.set_uint("window-gap-size", 4);
  const kbdSettings = new Settings();
  kbdSettings.set_string("mod-mask-mouse-tile", "None");
  kbdSettings.set_strv("window-focus-left", ["<Super>h"]);
  const configMgr = { settingsProps, keybindingsProps };
  const sync = new ConfigSync({ configMgr, settings, kbdSettings });
  const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {});
  return { sync, settings, kbdSettings, warn };
}

const rejected = (warn) => warn.mock.calls.map(([msg]) => msg);
const nonObjects = [
  ["a string", "x"],
  ["a number", 5],
  ["an array", []],
  ["null", null],
];

describe("a non-object category or bindings value is a rejected entry", () => {
  it.each(nonObjects)("settings: %s category is rejected, the other lands", (_, value) => {
    const { sync, settings, warn } = setup({
      settingsProps: { appearance: value, behavior: { "auto-split-enabled": true } },
    });

    expect(sync.importAll()).toMatchObject({ settings: false, applied: 1 });
    expect(rejected(warn)).toEqual(["Import rejected appearance"]);
    expect(settings.get_boolean("auto-split-enabled")).toBe(true);
    expect(settings.get_uint("window-gap-size")).toBe(4);
    sync.destroy();
  });

  it.each(nonObjects)("keybindings: %s bindings is rejected, the string key lands", (_, value) => {
    const { sync, kbdSettings, warn } = setup({
      keybindingsProps: { "mod-mask-mouse-tile": "<Super>", bindings: value },
    });

    expect(sync.importAll()).toMatchObject({ keybindings: false, applied: 1 });
    expect(rejected(warn)).toEqual(["Import rejected bindings"]);
    expect(kbdSettings.get_string("mod-mask-mouse-tile")).toBe("<Super>");
    expect(kbdSettings.get_strv("window-focus-left")).toEqual(["<Super>h"]);
    sync.destroy();
  });

  it("unknown keys and categories stay ignored (R19)", () => {
    const { sync, settings, warn } = setup({
      settingsProps: {
        $schema: "file:///settings.schema.json",
        version: 1,
        "no-such-category": "x",
        appearance: { "no-such-key": 1, "window-gap-size": 8 },
      },
      keybindingsProps: { "no-such-key": 1, bindings: { "no-such-binding": 1 } },
    });

    expect(sync.importAll()).toEqual({ settings: true, keybindings: true, applied: 1 });
    expect(rejected(warn)).toEqual([]);
    expect(settings.get_uint("window-gap-size")).toBe(8);
    sync.destroy();
  });
});
