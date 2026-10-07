import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import { Settings as MockSettings } from "../mocks/gnome/Gio.js";

// Stub everything enable() builds after the override loop: this test is about the
// GNOME override lifecycle only, and the real managers need a live shell.
vi.mock("../../lib/extension/indicator.js", () => ({
  FeatureIndicator: class FeatureIndicator {
    quickSettingsItems = [];
    destroy() {}
  },
  FeatureMenuToggle: vi.fn(function FeatureMenuToggle() {
    this.destroy = vi.fn();
  }),
}));
vi.mock("../../lib/shared/config-sync.js", async (importOriginal) => ({
  ...(await importOriginal()),
  ConfigSync: class ConfigSync {
    init() {}
    destroy() {}
  },
}));
vi.mock("../../lib/shared/settings.js", () => ({
  ConfigManager: class ConfigManager {},
}));
vi.mock("../../lib/extension/extension-theme-manager.js", () => ({
  ExtensionThemeManager: class ExtensionThemeManager {
    patchCss() {}
    reloadStylesheet() {}
    unloadStylesheet() {}
  },
}));
vi.mock("../../lib/extension/window.js", () => ({
  WindowManager: class WindowManager {
    enable() {}
    disable() {}
  },
}));
vi.mock("../../lib/extension/keybindings.js", () => ({
  Keybindings: class Keybindings {
    enable() {}
    disable() {}
  },
}));
vi.mock("../../lib/extension/cheatsheet.js", () => ({
  Cheatsheet: class Cheatsheet {
    destroy() {}
  },
}));

import ForgeExtension from "../../extension.js";

/**
 * Nouuu/forge#9: on Ubuntu, Super+Q locked the screen after some logins and showed the
 * dock's app-number overlay after others (live session 2026-10-07).
 *
 * Root cause: the Ubuntu dock (dash-to-dock) binds its `shortcut` key to `<Super>q`, the
 * default chord of Forge's `prefs-lock-screen`. Two global keybindings on one accelerator:
 * Mutter gives the key to one of them by registration order, so the extensions' enable
 * order decided.
 *
 * Fix: a SETTINGS_OVERRIDES entry clears the dock's `shortcut` while a Forge keybinding
 * carries `<Super>q` (`conflictsWith`, as for Super+L), and gives it back on disable or
 * as soon as no Forge binding carries it. Mutter follows the key, so the dock drops its
 * grab at once.
 */
const DOCK = "org.gnome.shell.extensions.dash-to-dock";
const KBD = "org.gnome.shell.extensions.forge.keybindings";

describe("Nouuu/forge#9: Super+Q goes to Forge, not to the Ubuntu dock", () => {
  let created;
  let RealSettings;
  let realSchemaSource;
  let forgeSettings;
  let kbdSettings;

  beforeEach(() => {
    created = new Map();
    RealSettings = Gio.Settings;
    realSchemaSource = Gio.SettingsSchemaSource;
    // The mock Gio has no SettingsSchemaSource; _applyOverride probes it as a
    // crash guard (forge-rj4x). Report every schema/key present.
    Gio.SettingsSchemaSource = {
      get_default: () => ({ lookup: () => ({ has_key: () => true }) }),
    };
    // One shared instance per schema, like dconf.
    Gio.Settings = class SharedSettings extends MockSettings {
      constructor(props) {
        const schemaId = typeof props === "string" ? props : props?.schemaId;
        super(schemaId);
        if (created.has(schemaId)) return created.get(schemaId);
        this.schema_id = schemaId;
        created.set(schemaId, this);
      }
    };
    forgeSettings = new MockSettings("org.gnome.shell.extensions.forge");
    kbdSettings = new MockSettings(KBD);
  });

  afterEach(() => {
    Gio.Settings = RealSettings;
    Gio.SettingsSchemaSource = realSchemaSource;
  });

  function enableForge() {
    const ext = new ForgeExtension();
    ext.getSettings = vi.fn((schemaId) => (schemaId === KBD ? kbdSettings : forgeSettings));
    ext.enable();
    return ext;
  }

  function seedDock() {
    const dock = new Gio.Settings({ schemaId: DOCK });
    dock.set_strv("shortcut", ["<Super>q"]);
    return dock;
  }

  it("frees the dock's Super+Q while Forge locks on it, and gives it back on disable", () => {
    const dock = seedDock();
    kbdSettings.set_strv("prefs-lock-screen", ["<Super>q"]);

    const ext = enableForge();
    expect(dock.get_strv("shortcut")).toEqual([]);

    ext.disable();
    expect(dock.get_strv("shortcut")).toEqual(["<Super>q"]);
  });

  it("leaves the dock alone when no Forge binding uses <Super>q", () => {
    const dock = seedDock();
    kbdSettings.set_strv("prefs-lock-screen", ["<Super>Escape"]);

    enableForge();

    expect(dock.get_strv("shortcut")).toEqual(["<Super>q"]);
  });

  it("hands Super+Q back to the dock as soon as Forge stops binding it", () => {
    const dock = seedDock();
    kbdSettings.set_strv("prefs-lock-screen", ["<Super>q"]);
    enableForge();
    expect(dock.get_strv("shortcut")).toEqual([]);

    kbdSettings.set_strv("prefs-lock-screen", ["<Super>Escape"]);
    kbdSettings.emit("changed", "prefs-lock-screen");

    expect(dock.get_strv("shortcut")).toEqual(["<Super>q"]);
  });
});
