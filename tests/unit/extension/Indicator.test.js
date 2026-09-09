import { describe, it, expect, beforeEach, vi } from "vitest";
import Gio from "gi://Gio";
import { FeatureIndicator, FeatureMenuToggle } from "../../../lib/extension/indicator.js";

/**
 * Dedicated unit suite for lib/extension/indicator.js (Quick Settings).
 *
 * The module was excluded from the coverage ratchet and stubbed out by the only two
 * tests that mention it (bug-354, bug-forge-tus6), so none of its three classes had
 * ever executed under Vitest — including the forge-4zl2 switch sync and the
 * three-boolean tray rule (Feature #286) that regression tests reference by name.
 */
function createExtension(values = {}) {
  const settings = Gio.Settings.new("org.gnome.shell.extensions.forge");
  for (const [key, value] of Object.entries(values)) settings.set_boolean(key, value);
  return {
    settings,
    uuid: "forge@jmmaranan.com",
    openPreferences: vi.fn(),
  };
}

const ALL_ON = {
  "tiling-mode-enabled": true,
  "quick-settings-enabled": true,
  "tray-icon-enabled": true,
};

describe("FeatureIndicator", () => {
  let extension;

  beforeEach(() => {
    extension = createExtension(ALL_ON);
  });

  // Feature #286: the tray icon needs all three booleans, quick-settings-enabled
  // being kept as the backwards-compatible master switch.
  it("shows the tray icon only when all three booleans are set", () => {
    const indicator = new FeatureIndicator(extension);
    expect(indicator._indicator.visible).toBe(true);

    for (const key of ["tray-icon-enabled", "quick-settings-enabled", "tiling-mode-enabled"]) {
      extension.settings.set_boolean(key, false);
      extension.settings.emit("changed", extension.settings, key);
      expect(indicator._indicator.visible).toBe(false);

      extension.settings.set_boolean(key, true);
      extension.settings.emit("changed", extension.settings, key);
      expect(indicator._indicator.visible).toBe(true);
    }
  });

  it("ignores keys outside the tray rule", () => {
    const indicator = new FeatureIndicator(extension);
    extension.settings.set_boolean("tray-icon-enabled", false);

    // A different key must not re-evaluate visibility.
    extension.settings.emit("changed", extension.settings, "window-gap-size");

    expect(indicator._indicator.visible).toBe(true);
  });

  it("disconnects its settings handler on destroy", () => {
    const indicator = new FeatureIndicator(extension);
    expect(indicator._settingsChangedId).not.toBeNull();

    indicator.destroy();

    expect(indicator._settingsChangedId).toBeNull();
    // A change after teardown must not reach the (now finalized) indicator.
    extension.settings.set_boolean("tray-icon-enabled", false);
    expect(() =>
      extension.settings.emit("changed", extension.settings, "tray-icon-enabled")
    ).not.toThrow();
  });

  // forge-5r0j: `_destroyed` is a flag Forge never assigns, so guarding on it is
  // vacuous — a finalized St actor reports itself by throwing on the first property
  // access, not by setting a flag. The handler runs on a GSettings signal, so an
  // escaping throw surfaces as an unhandled exception in the shell's main loop.
  it("survives a finalized indicator actor", () => {
    const indicator = new FeatureIndicator(extension);
    Object.defineProperty(indicator._indicator, "visible", {
      get() {
        throw new Error("Object St.Icon has been finalized");
      },
      set() {
        throw new Error("Object St.Icon has been finalized");
      },
    });

    extension.settings.set_boolean("tray-icon-enabled", false);

    expect(() =>
      extension.settings.emit("changed", extension.settings, "tray-icon-enabled")
    ).not.toThrow();
  });
});

describe("FeatureMenuToggle", () => {
  let extension;

  beforeEach(() => {
    extension = createExtension({ ...ALL_ON, "window-gap-hidden-on-single": false });
  });

  it("binds its checked and visible state to settings", () => {
    const toggle = new FeatureMenuToggle(extension);

    expect(toggle.checked).toBe(true);
    expect(toggle.visible).toBe(true);

    extension.settings.set_boolean("tiling-mode-enabled", false);
    extension.settings.emit("changed::tiling-mode-enabled", extension.settings);
    expect(toggle.checked).toBe(false);
  });

  // Characterisation before removing the isGnomeGTE(45) ternary: metadata.json
  // declares shell-version 45..50, so the < 45 branch (which passed `label`
  // instead of `title`) is unreachable. This must stay green across the removal.
  it("titles the toggle with the GNOME 45+ property name", () => {
    const toggle = new FeatureMenuToggle(extension);

    expect(toggle.title).toBe("Tiling");
    expect(toggle.label).toBeUndefined();
    expect(toggle.toggleMode).toBe(true);
  });

  it("builds the menu with the three switches and a settings action", () => {
    const toggle = new FeatureMenuToggle(extension);

    expect(toggle.menu._header.title).toBe("Forge");
    expect(toggle._singleSwitch.label).toBe("Gaps Hidden when Single");
    expect(toggle._focusHintSwitch.label).toBe("Show Focus Hint Border");
    expect(toggle._focusMovePointer.label).toBe("Move Pointer with the Focus");
    expect(toggle.menu._settingsActions[extension.uuid]).toBeDefined();
  });

  it("opens preferences from the settings action", () => {
    const toggle = new FeatureMenuToggle(extension);

    toggle.menu._settingsActions[extension.uuid].callback();

    expect(extension.openPreferences).toHaveBeenCalledOnce();
  });

  // forge-4zl2: the switch snapshotted its value at construction and only wrote on
  // 'toggled', so changing the same key elsewhere (keybinding or prefs) left it
  // stale — and toggling it afterwards silently rewrote the value it already held.
  it("keeps a switch in sync when its key changes elsewhere", () => {
    const toggle = new FeatureMenuToggle(extension);
    expect(toggle._singleSwitch.state).toBe(false);

    extension.settings.set_boolean("window-gap-hidden-on-single", true);
    extension.settings.emit("changed::window-gap-hidden-on-single", extension.settings);

    expect(toggle._singleSwitch.state).toBe(true);
  });

  // Same leak class as forge-5y6j: a switch that outlives its disconnect keeps
  // firing into a destroyed widget on every change of the key it tracked.
  it("disconnects a switch's settings handler when the switch is destroyed", () => {
    const toggle = new FeatureMenuToggle(extension);
    const sw = toggle._singleSwitch;
    expect(sw._settingsChangedId).not.toBeNull();

    sw.emit("destroy", sw);

    expect(sw._settingsChangedId).toBeNull();
    // The switch must no longer track the key it was bound to.
    extension.settings.set_boolean("window-gap-hidden-on-single", true);
    extension.settings.emit("changed::window-gap-hidden-on-single", extension.settings);
    expect(sw.state).toBe(false);
  });

  it("writes the setting when a switch is toggled", () => {
    const toggle = new FeatureMenuToggle(extension);

    toggle._singleSwitch.state = true;
    toggle._singleSwitch.emit("toggled", toggle._singleSwitch);

    expect(extension.settings.get_boolean("window-gap-hidden-on-single")).toBe(true);
  });
});
