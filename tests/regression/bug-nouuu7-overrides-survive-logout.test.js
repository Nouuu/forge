import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
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
 * Nouuu/forge#7: the GNOME settings Forge overrides never got their GNOME value back
 * after a logout with Forge enabled (live session 2026-10-07: `edge-tiling` stayed
 * `false` after `gnome-extensions disable`).
 *
 * Root cause: enable() kept each original in memory only, and disable() is the only
 * place that writes it back. GNOME Shell does not run disable() at logout, so the
 * forced value stayed in dconf and the next enable() saved it as the original.
 *
 * Fix: the originals live in the Forge key `gnome-overrides-originals` (`a{sv}`).
 * enable() reuses a saved original when the GNOME value still equals the forced one;
 * with nothing saved it takes the schema default (maintainer, 2026-10-07). A restore
 * writes the original back and drops its entry.
 */
const MUTTER = "org.gnome.mutter";
const WM_KEYS = "org.gnome.desktop.wm.keybindings";
const KBD = "org.gnome.shell.extensions.forge.keybindings";
const STORE = "gnome-overrides-originals";

describe("Nouuu/forge#7: GNOME override originals survive a logout", () => {
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
    // One shared instance per schema, like dconf: every session reads what the
    // previous one left.
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
    forgeSettings.set_boolean("disable-edge-tiling", true);
    forgeSettings.set_boolean("tiling-mode-enabled", true);
    forgeSettings.set_value(STORE, new GLib.Variant("a{sv}", {}));
    kbdSettings = new MockSettings(KBD);
  });

  afterEach(() => {
    Gio.Settings = RealSettings;
    Gio.SettingsSchemaSource = realSchemaSource;
  });

  /** A new shell session: a fresh extension object over the same dconf. */
  function login() {
    const ext = new ForgeExtension();
    ext.getSettings = vi.fn((schemaId) => (schemaId === KBD ? kbdSettings : forgeSettings));
    ext.enable();
    return ext;
  }

  const mutter = () => new Gio.Settings({ schemaId: MUTTER });
  const saved = () => forgeSettings.get_value(STORE).deepUnpack();

  it("gives the GNOME value back after a session that ended without disable()", () => {
    mutter().set_boolean("edge-tiling", true);
    login(); // the shell exits at logout: no disable()
    expect(mutter().get_boolean("edge-tiling")).toBe(false);

    const ext = login();
    ext.disable();

    expect(mutter().get_boolean("edge-tiling")).toBe(true);
  });

  it("keeps a value the user changed while Forge was running", () => {
    const wm = new Gio.Settings({ schemaId: WM_KEYS });
    wm.set_strv("minimize", ["<Super>h"]);
    login();
    wm.set_strv("minimize", ["<Super>n"]);

    const ext = login();
    ext.disable();

    expect(wm.get_strv("minimize")).toEqual(["<Super>n"]);
  });

  it("takes the schema default when a forced value is found with nothing saved", () => {
    mutter().set_boolean("edge-tiling", false);
    vi.spyOn(mutter(), "get_default_value").mockReturnValue(new GLib.Variant("b", true));

    const ext = login();
    ext.disable();

    expect(mutter().get_boolean("edge-tiling")).toBe(true);
  });

  it("saves the original while the override applies and drops it on restore", () => {
    mutter().set_boolean("edge-tiling", true);
    const ext = login();
    expect(saved()[`${MUTTER} edge-tiling`]?.deepUnpack()).toBe(true);

    ext.disable();

    expect(saved()).not.toHaveProperty(`${MUTTER} edge-tiling`);
  });

  it("restores once when the gate turns off, then disable() writes nothing more", () => {
    mutter().set_boolean("edge-tiling", true);
    const ext = login();
    forgeSettings.set_boolean("disable-edge-tiling", false);
    forgeSettings.emit("changed::disable-edge-tiling", "disable-edge-tiling");
    expect(mutter().get_boolean("edge-tiling")).toBe(true);
    expect(saved()).not.toHaveProperty(`${MUTTER} edge-tiling`);
    const write = vi.spyOn(mutter(), "set_value");

    ext.disable();

    expect(write).not.toHaveBeenCalledWith("edge-tiling", expect.anything());
  });
});
