// close-spec-gaps:T072: importSettings and importKeybindings walked a file whose root parsed
// but was not a plain object ("x", 5, []) as if empty: every category read undefined, nothing
// was rejected and the file reported success.
// Fix: a truthy root that is not a plain object is a failed import for that file, logged as
// "Import rejected <file> root" with a false result. Missing and unparsable files (null) keep
// returning false as before, and a valid file still imports with no rejection.
import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfigSync } from "../../lib/shared/config-sync.js";
import { Logger } from "../../lib/shared/logger.js";
import { Settings } from "../mocks/gnome/Gio.js";

afterEach(() => vi.restoreAllMocks());

function setup(configMgr) {
  const settings = new Settings();
  settings.set_uint("window-gap-size", 4);
  const kbdSettings = new Settings();
  const sync = new ConfigSync({ configMgr, settings, kbdSettings });
  const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {});
  return { sync, settings, warn };
}

const roots = [
  ["a string", "x"],
  ["a number", 5],
  ["an array", []],
];

describe("a file root that is not an object is a failed import", () => {
  it.each(roots)("settings.json root %s", (_, root) => {
    const { sync, warn } = setup({ settingsProps: root, keybindingsProps: null });
    expect(sync.importSettings()).toBe(false);
    expect(warn.mock.calls.map(([m]) => m)).toEqual(["Import rejected settings.json root"]);
    sync.destroy();
  });

  it.each(roots)("keybindings.json root %s", (_, root) => {
    const { sync, warn } = setup({ settingsProps: null, keybindingsProps: root });
    expect(sync.importKeybindings()).toBe(false);
    expect(warn.mock.calls.map(([m]) => m)).toEqual(["Import rejected keybindings.json root"]);
    sync.destroy();
  });

  it("importAll reports both files failed with nothing applied", () => {
    const { sync } = setup({ settingsProps: "x", keybindingsProps: [] });
    expect(sync.importAll()).toEqual({ settings: false, keybindings: false, applied: 0 });
    sync.destroy();
  });

  it("a missing file stays false, a valid file imports with no rejection", () => {
    const { sync, settings, warn } = setup({
      settingsProps: { appearance: { "window-gap-size": 8 } },
      keybindingsProps: null,
    });
    expect(sync.importAll()).toEqual({ settings: true, keybindings: false, applied: 1 });
    expect(settings.get_uint("window-gap-size")).toBe(8);
    expect(warn).not.toHaveBeenCalled();
    sync.destroy();
  });
});
