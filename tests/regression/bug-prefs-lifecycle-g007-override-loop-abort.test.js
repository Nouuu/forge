import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import { Settings as MockSettings } from "../mocks/gnome/Gio.js";
import { SETTINGS_OVERRIDES } from "../../lib/shared/gnome-overrides.js";

vi.mock("../../lib/extension/indicator.js", () => ({
  FeatureIndicator: class FeatureIndicator {
    quickSettingsItems = [];
    destroy() {}
  },
  FeatureMenuToggle: vi.fn(function FeatureMenuToggle() {
    this.destroy = vi.fn();
  }),
}));

// The realistic throw site: config import writes GSettings and can fail on a
// corrupt/unreadable ~/.config/forge.
vi.mock("../../lib/shared/config-sync.js", async (importOriginal) => ({
  // Keep the real exports (gnome-overrides.js reads bindingKeysOf from here).
  ...(await importOriginal()),
  ConfigSync: class ConfigSync {
    init() {
      throw new Error("simulated config import failure");
    }
    destroy() {}
  },
}));

import ForgeExtension from "../../extension.js";

/**
 * prefs-lifecycle:G007. Root cause: enable() and disable() wrapped the whole
 * override loop in one try, so one override that threw skipped every later one
 * (left unforced on enable, left forced in dconf on disable).
 * Fix: the try/catch sits in _applyOverride and _restoreOverride, so each item
 * fails alone and disable() restores through _restoreOverride per saved entry.
 */

/** Originals we seed so a restore is observable (must differ from the override). */
function seedOriginal(desc) {
  return typeof desc.newValue === "boolean" ? true : [`<Super>original-${desc.key}`];
}

describe("prefs-lifecycle:G007: one failing GNOME override does not skip the rest", () => {
  let created;
  let failKey;
  let realSchemaSource;
  let RealSettings;

  beforeEach(() => {
    created = new Map();
    failKey = null;
    RealSettings = Gio.Settings;
    realSchemaSource = Gio.SettingsSchemaSource;

    // The mock Gio has no SettingsSchemaSource; _applyOverride probes it as a
    // crash guard (forge-rj4x). Report every schema/key present.
    Gio.SettingsSchemaSource = {
      get_default: () => ({ lookup: () => ({ has_key: () => true }) }),
    };

    // Record every GNOME Gio.Settings the extension constructs, pre-seeded with
    // the "user's" original values.
    Gio.Settings = class RecordingSettings extends MockSettings {
      constructor(props) {
        const schemaId = typeof props === "string" ? props : props?.schemaId;
        super(schemaId);
        this.schema_id = schemaId;
        for (const desc of SETTINGS_OVERRIDES) {
          if (desc.schemaId !== schemaId) continue;
          const setter = typeof desc.newValue === "boolean" ? "set_boolean" : "set_strv";
          this[setter](desc.key, seedOriginal(desc));
        }
        created.set(schemaId, this);
      }

      set_value(key, value) {
        if (key === failKey) throw new Error(`simulated write failure for ${key}`);
        super.set_value(key, value);
      }
    };
  });

  afterEach(() => {
    Gio.Settings = RealSettings;
    Gio.SettingsSchemaSource = realSchemaSource;
  });

  function buildExtension() {
    const ext = new ForgeExtension();
    const forgeSettings = new MockSettings("org.gnome.shell.extensions.forge");
    // Ungate every gated override so all of them actually apply: the edge-tiling
    // booleans, and the shipped focus bindings so every `conflictsWith` override
    // (Super+L, the dock's Super+Q, the four Super+arrows) has a conflict to free.
    forgeSettings.set_boolean("disable-edge-tiling", true);
    forgeSettings.set_boolean("tiling-mode-enabled", true);
    const kbdSettings = new MockSettings("org.gnome.shell.extensions.forge.keybindings");
    kbdSettings.set_strv("window-focus-left", ["<Super>h", "<Super>Left"]);
    kbdSettings.set_strv("window-focus-down", ["<Super>j", "<Super>Down"]);
    kbdSettings.set_strv("window-focus-up", ["<Super>k", "<Super>Up"]);
    kbdSettings.set_strv("window-focus-right", ["<Super>l", "<Super>Right"]);
    kbdSettings.set_strv("prefs-lock-screen", ["<Super>q"]);
    ext.getSettings = vi.fn((schemaId) =>
      schemaId === "org.gnome.shell.extensions.forge.keybindings" ? kbdSettings : forgeSettings
    );
    return ext;
  }

  const getOf = (desc) => {
    const g = created.get(desc.schemaId);
    return g[typeof desc.newValue === "boolean" ? "get_boolean" : "get_strv"](desc.key);
  };

  it("enable(): a throwing override leaves every other override applied", () => {
    const ext = buildExtension();
    ext.disable = vi.fn(); // keep the applied state: the failed enable() would restore it
    failKey = SETTINGS_OVERRIDES[0].key;

    expect(() => ext.enable()).toThrow(/simulated config import failure/);

    const others = SETTINGS_OVERRIDES.filter((d) => d.key !== failKey);
    expect(others.length).toBeGreaterThan(0);
    for (const desc of others) {
      expect(getOf(desc), `${desc.schemaId} '${desc.key}' not applied`).toEqual(desc.newValue);
    }
  });

  it("disable(): a throwing restore leaves every other key at its original", () => {
    const ext = buildExtension();
    const realDisable = ForgeExtension.prototype.disable;
    ext.disable = vi.fn();
    expect(() => ext.enable()).toThrow(/simulated config import failure/);
    for (const desc of SETTINGS_OVERRIDES) expect(getOf(desc)).toEqual(desc.newValue);

    failKey = SETTINGS_OVERRIDES[0].key;
    realDisable.call(ext);

    const others = SETTINGS_OVERRIDES.filter((d) => d.key !== failKey);
    for (const desc of others) {
      expect(getOf(desc), `${desc.schemaId} '${desc.key}' not restored`).toEqual(
        seedOriginal(desc)
      );
    }
  });
});
