// theming-config:G010: importing a portable config claimed full success when an entry was
// rejected. importKeybindings skipped a non-list binding with no log, and importSettings
// dropped the boolean from set_value, so a value GSettings refuses (outside a gschema range
// or choices list) also read as imported.
// Fix: _setSettingValue returns set_value's result; _importSettingsCategory logs each
// rejected key and returns false; importKeybindings logs a non-list binding and checks the
// set_strv/set_string results. Valid entries still land and config-last-import still bumps.
import { describe, it, expect } from "vitest";
import { ConfigSync } from "../../lib/shared/config-sync.js";
import { Settings } from "../mocks/gnome/Gio.js";

function setup({ settingsProps, keybindingsProps, refuse = [] }) {
  const settings = new Settings();
  const kbdSettings = new Settings();
  settings.set_uint("window-gap-size", 4);
  settings.set_uint("window-margin-top", 0);
  kbdSettings.set_strv("window-focus-left", ["<Super>h"]);
  kbdSettings.set_strv("window-focus-right", ["<Super>l"]);
  const realSet = settings.set_value.bind(settings);
  settings.set_value = (key, v) => (refuse.includes(key) ? false : realSet(key, v));
  const configMgr = { settingsProps, keybindingsProps };
  const sync = new ConfigSync({ configMgr, settings, kbdSettings });
  return { sync, settings, kbdSettings };
}

describe("import reports a rejected entry", () => {
  it("keybindings: a non-list binding fails the file, the valid one lands", () => {
    const { sync, kbdSettings } = setup({
      keybindingsProps: {
        bindings: { "window-focus-left": "<Super>h", "window-focus-right": ["<Super>k"] },
      },
    });
    expect(sync.importKeybindings()).toBe(false);
    expect(kbdSettings.get_strv("window-focus-right")).toEqual(["<Super>k"]);
    expect(kbdSettings.get_strv("window-focus-left")).toEqual(["<Super>h"]);
    sync.destroy();
  });

  it("settings: a refused value fails the file, the valid one lands", () => {
    const { sync, settings } = setup({
      settingsProps: { appearance: { "window-gap-size": 99, "window-margin-top": 7 } },
      refuse: ["window-gap-size"],
    });
    expect(sync.importSettings()).toBe(false);
    expect(settings.get_uint("window-margin-top")).toBe(7);
    expect(settings.get_uint("window-gap-size")).toBe(4);
    sync.destroy();
  });

  it("importAll reports settings: false", () => {
    const { sync } = setup({
      settingsProps: { appearance: { "window-gap-size": 99, "window-margin-top": 7 } },
      keybindingsProps: { bindings: { "window-focus-right": ["<Super>k"] } },
      refuse: ["window-gap-size"],
    });
    expect(sync.importAll()).toMatchObject({ settings: false, keybindings: true });
    sync.destroy();
  });
});
