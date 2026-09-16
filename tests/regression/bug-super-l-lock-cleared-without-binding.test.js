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

const MEDIA_KEYS = "org.gnome.settings-daemon.plugins.media-keys";
const KBD = "org.gnome.shell.extensions.forge.keybindings";

/**
 * Bug super-l-lock-cleared-without-binding (2026-09-16, maintainer's live session):
 * GNOME's Super+L lock kept vanishing. The user had dropped `<Super>l` from
 * Forge's `window-focus-right` (`['<Super>Right']`) and re-set the system
 * shortcut in Settings, yet every login erased it again.
 *
 * Root cause: the `media-keys screensaver → []` override (forge-m37) was
 * unconditional. It exists only so `<Super>l` can drive vim focus-right, but
 * enable() wrote it whether or not any Forge keybinding still used `<Super>l`.
 * And disable() — the only restore path — never runs on logout (gnome-shell is
 * killed), so the cleared value outlived every session.
 *
 * Fix: the override declares `conflictsWith: "<Super>l"`; it applies only while
 * some Forge keybinding carries that accelerator verbatim, and a `changed`
 * listener on the keybindings schema reconciles it at runtime (forge-abk
 * mechanics), so removing `<Super>l` in prefs hands the lock back immediately.
 */
describe("Bug super-l-lock-cleared-without-binding: Super+L override follows the binding", () => {
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
    // One shared instance per schema, like dconf: the value the test seeds is the
    // value the extension's own Gio.Settings reads and writes.
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

  function buildExtension() {
    const ext = new ForgeExtension();
    ext.getSettings = vi.fn((schemaId) => (schemaId === KBD ? kbdSettings : forgeSettings));
    return ext;
  }

  /** The system lock shortcut as GNOME (the "user") had it before Forge enabled. */
  function seedSystemLock() {
    const mediaKeys = new Gio.Settings({ schemaId: MEDIA_KEYS });
    mediaKeys.set_strv("screensaver", ["<Super>l"]);
    return mediaKeys;
  }

  it("leaves the system Super+L lock alone when no Forge keybinding uses <Super>l", () => {
    const mediaKeys = seedSystemLock();
    const setStrv = vi.spyOn(mediaKeys, "set_strv");
    kbdSettings.set_strv("window-focus-right", ["<Super>Right"]);

    const ext = buildExtension();
    ext.enable();

    expect(mediaKeys.get_strv("screensaver")).toEqual(["<Super>l"]);
    expect(setStrv).not.toHaveBeenCalledWith("screensaver", expect.anything());
    ext.disable();
    expect(mediaKeys.get_strv("screensaver")).toEqual(["<Super>l"]);
  });

  it("still frees Super+L while a Forge keybinding carries <Super>l, and restores it on disable", () => {
    const mediaKeys = seedSystemLock();
    kbdSettings.set_strv("window-focus-right", ["<Super>l", "<Super>Right"]);

    const ext = buildExtension();
    ext.enable();
    expect(mediaKeys.get_strv("screensaver")).toEqual([]);

    ext.disable();
    expect(mediaKeys.get_strv("screensaver")).toEqual(["<Super>l"]);
  });

  it("hands the lock back the moment <Super>l is removed from Forge's bindings, and frees it again when re-added", () => {
    const mediaKeys = seedSystemLock();
    kbdSettings.set_strv("window-focus-right", ["<Super>l", "<Super>Right"]);
    const ext = buildExtension();
    ext.enable();
    expect(mediaKeys.get_strv("screensaver")).toEqual([]);

    // User edits the binding in prefs: the keybindings schema emits `changed`.
    kbdSettings.set_strv("window-focus-right", ["<Super>Right"]);
    kbdSettings.emit("changed", "window-focus-right");
    expect(mediaKeys.get_strv("screensaver")).toEqual(["<Super>l"]);

    kbdSettings.set_strv("window-focus-right", ["<Super>l"]);
    kbdSettings.emit("changed", "window-focus-right");
    expect(mediaKeys.get_strv("screensaver")).toEqual([]);

    ext.disable();
    expect(mediaKeys.get_strv("screensaver")).toEqual(["<Super>l"]);
  });

  it("connects one keybindings listener on enable and drops it on disable", () => {
    seedSystemLock();
    kbdSettings.set_strv("window-focus-right", ["<Super>l"]);
    const ext = buildExtension();

    ext.enable();
    expect(kbdSettings.getHandlerCount("changed")).toBe(1);

    ext.disable();
    expect(kbdSettings.getHandlerCount("changed")).toBe(0);
  });
});
