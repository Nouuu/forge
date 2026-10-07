/*
 * This file is part of the Forge GNOME extension
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// Gnome imports
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

// Shared state
import { Logger } from "./lib/shared/logger.js";
import { ConfigManager } from "./lib/shared/settings.js";
import { ConfigSync } from "./lib/shared/config-sync.js";
import {
  SETTINGS_OVERRIDES,
  shouldApplyOverride,
  overridesGatedBy,
  overridesConflictingWithBindings,
  reconcileAction,
} from "./lib/shared/gnome-overrides.js";

// Application imports
import { Cheatsheet } from "./lib/extension/cheatsheet.js";
import { Keybindings } from "./lib/extension/keybindings.js";
import { WindowManager } from "./lib/extension/window.js";
import { FeatureIndicator, FeatureMenuToggle } from "./lib/extension/indicator.js";
import { ExtensionThemeManager } from "./lib/extension/extension-theme-manager.js";

// SETTINGS_OVERRIDES + shouldApplyOverride live in lib/shared/gnome-overrides.js
// (GTK-free) so the gating policy is unit-testable.

const OVERRIDE_ORIGINALS = "gnome-overrides-originals";
// Overrides whose schema or key is absent here, each logged once per shell session.
const missingOverrides = new Set();

export default class ForgeExtension extends Extension {
  enable() {
    this.settings = this.getSettings();
    this.kbdSettings = this.getSettings("org.gnome.shell.extensions.forge.keybindings");
    Logger.init(this.settings);
    Logger.info("enable");

    // Disable GNOME features and keybindings that conflict with Forge (#461, #288)
    this._savedSettings = [];
    this._gnomeSettings = new Map();
    try {
      for (const desc of SETTINGS_OVERRIDES) {
        // Skip overrides the user has opted out of (forge-9fo). A gated-off
        // override is neither applied nor saved, so disable() has nothing to
        // restore for it — handled before any Gio.Settings construction.
        if (!shouldApplyOverride(desc, this.settings, this.kbdSettings)) {
          Logger.info(`Skipping GNOME override: ${desc.schemaId} '${desc.key}' disabled in prefs`);
          continue;
        }
        this._applyOverride(desc);
      }
      Logger.info("Disabled conflicting GNOME settings and keybindings");
    } catch (e) {
      Logger.warn(`Failed to disable GNOME conflicting features: ${e}`);
    }

    // forge-tus6: everything below can throw (config import does GSettings writes,
    // the managers build actors, patchCss touches the filesystem). GNOME Shell's
    // _callExtensionEnable catches a throw from enable(), marks the extension ERROR
    // and does NOT call disable() — so without this the overrides applied above stay
    // written to the user's dconf, surviving even an uninstall: native maximize/
    // minimize/tile keybindings and Super+L would be permanently dead with no
    // Forge left to restore them. Tear down on the way out, then rethrow so the
    // Shell still reports the real failure.
    try {
      // forge-abk: some overrides are gated on a runtime-toggleable Forge setting
      // (edge-tiling on tiling-mode-enabled). Re-evaluate them when those settings
      // change so e.g. toggling Forge tiling off restores GNOME's native
      // edge-tiling, and toggling it back on re-applies the override.
      const settings = this.settings;
      // Unreachable in practice (getSettings() throws on a missing schema rather
      // than returning null); kept for type-narrowing. Throwing rather than
      // returning routes it through the same restore path as any other failure.
      if (!settings) throw new Error("enable: settings unavailable");
      this._overrideReconcileIds = ["tiling-mode-enabled", "disable-edge-tiling"].map((key) =>
        settings.connect(`changed::${key}`, () => this._reconcileOverridesFor(key))
      );
      // Same for overrides that follow a Forge keybinding (`conflictsWith`): drop
      // <Super>l from prefs and GNOME's Super+L lock comes back at once.
      this._kbdReconcileId = this.kbdSettings.connect("changed", () =>
        this._reconcileBindingOverrides()
      );

      this.configMgr = new ConfigManager(this);

      // Initialize config sync - imports from files if they exist
      this.configSync = new ConfigSync({
        configMgr: this.configMgr,
        settings: this.settings,
        kbdSettings: this.kbdSettings,
      });
      this.configSync.init();

      this.theme = new ExtensionThemeManager(this);
      this.extWm = new WindowManager(this);
      this.keybindings = new Keybindings(this);
      this.cheatsheet = new Cheatsheet(this);
      this.keybindings.cheatsheet = this.cheatsheet;

      this._onSessionModeChanged(Main.sessionMode);
      this._sessionId = Main.sessionMode.connect("updated", this._onSessionModeChanged.bind(this));

      this.theme.patchCss();
      this.theme.reloadStylesheet();
      this.extWm.enable();
    } catch (e) {
      // disable() is the single source of truth for teardown: it restores
      // _savedSettings and drops whatever was constructed before the throw (every
      // member access there is optional-chained, so partial state is fine).
      try {
        this.disable();
      } catch (cleanupError) {
        Logger.error(`enable: cleanup after failed enable also failed: ${cleanupError}`);
      }
      throw e;
    }
    Logger.info(`enable: finalized vars`);
  }

  /**
   * Apply one GNOME settings override: save its current value (for restore) and
   * write the override value. Probes the schema/key first — constructing
   * Gio.Settings for an absent schema, or reading/writing an absent key, raises
   * a C-level g_error that TERMINATES gnome-shell and is NOT a catchable JS
   * exception (forge-rj4x), so the probe is a crash guard, not optional. The
   * core GNOME schemas are always present; the Ubuntu dock's is absent elsewhere,
   * and that is said once, at debug. Re-captures `original` fresh on every call, so a runtime re-apply
   * (forge-abk) records the user's latest GNOME value.
   */
  _applyOverride(desc) {
    if (!this._gnomeSettings || !this._savedSettings) return; // already disabled
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup(desc.schemaId, true);
    if (!schema || !schema.has_key(desc.key)) {
      const id = `${desc.schemaId} ${desc.key}`;
      if (!missingOverrides.has(id)) {
        missingOverrides.add(id);
        Logger.debug(`Skipping GNOME override: ${id} is unavailable`);
      }
      return;
    }
    if (!this._gnomeSettings.has(desc.schemaId)) {
      this._gnomeSettings.set(desc.schemaId, new Gio.Settings({ schemaId: desc.schemaId }));
    }
    const gsettings = this._gnomeSettings.get(desc.schemaId);
    if (!gsettings) return;
    const current = gsettings.get_value(desc.key);
    const forced = new GLib.Variant(current.get_type_string(), desc.newValue);
    // Nouuu/forge#7: a forced value here was left by a session that ended without disable().
    const original = current.equal(forced)
      ? this._savedOriginals()[`${desc.schemaId} ${desc.key}`] ??
        gsettings.get_default_value(desc.key)
      : current;
    this._saveOriginal(desc, original);
    gsettings.set_value(desc.key, forced);
    this._savedSettings.push({ schemaId: desc.schemaId, gsettings, key: desc.key, original });
  }

  /**
   * Originals of the applied overrides, kept in dconf because logout skips disable().
   * @returns {Record<string, GLib.Variant>}
   */
  _savedOriginals() {
    return this.settings?.get_value(OVERRIDE_ORIGINALS).deepUnpack() ?? {};
  }

  /** Keep `original` for `desc` across sessions, or drop it once restored (null). */
  _saveOriginal(desc, original) {
    const saved = this._savedOriginals();
    if (original) saved[`${desc.schemaId} ${desc.key}`] = original;
    else delete saved[`${desc.schemaId} ${desc.key}`];
    this.settings?.set_value(OVERRIDE_ORIGINALS, new GLib.Variant("a{sv}", saved));
  }

  /**
   * Restore one override to its saved original and drop it from _savedSettings
   * (so a later re-apply re-captures the current value). The cached Gio.Settings
   * in _gnomeSettings is kept for possible re-apply (forge-abk).
   */
  _restoreOverride(desc) {
    if (!this._savedSettings) return; // already disabled
    const idx = this._savedSettings.findIndex(
      (s) => s.schemaId === desc.schemaId && s.key === desc.key
    );
    if (idx < 0) return;
    const saved = this._savedSettings[idx];
    saved.gsettings.set_value(saved.key, saved.original);
    this._saveOriginal(saved, null);
    this._savedSettings.splice(idx, 1);
  }

  _isOverrideSaved(desc) {
    if (!this._savedSettings) return false; // already disabled
    return this._savedSettings.some((s) => s.schemaId === desc.schemaId && s.key === desc.key);
  }

  /**
   * forge-abk: when a gating Forge setting changes at runtime, apply or restore
   * each override it gates. Its only write to Forge settings is the
   * gnome-overrides-originals store, which no gate listens to, so this cannot
   * re-enter via the change signal. When the gate goes off, the user changes GNOME,
   * then the gate comes back on, the user's latest GNOME value wins (re-captured on
   * re-apply).
   */
  _reconcileOverridesFor(changedKey) {
    const settings = this.settings;
    if (!this._savedSettings || !this._gnomeSettings || !settings) return; // already disabled
    try {
      for (const desc of overridesGatedBy(changedKey)) {
        const action = reconcileAction(desc, settings, this._isOverrideSaved(desc));
        if (action === "apply") this._applyOverride(desc);
        else if (action === "restore") this._restoreOverride(desc);
      }
    } catch (e) {
      Logger.warn(`Failed to reconcile GNOME overrides for '${changedKey}': ${e}`);
    }
  }

  /** Keybindings changed: apply/restore every `conflictsWith` override. */
  _reconcileBindingOverrides() {
    const settings = this.settings;
    const kbdSettings = this.kbdSettings;
    if (!this._savedSettings || !this._gnomeSettings || !settings || !kbdSettings) return;
    try {
      for (const desc of overridesConflictingWithBindings()) {
        const action = reconcileAction(desc, settings, this._isOverrideSaved(desc), kbdSettings);
        if (action === "apply") this._applyOverride(desc);
        else if (action === "restore") this._restoreOverride(desc);
      }
    } catch (e) {
      Logger.warn(`Failed to reconcile GNOME overrides for keybindings: ${e}`);
    }
  }

  disable() {
    Logger.info("disable");

    // See session mode unlock-dialog explanation on _onSessionModeChanged()
    if (this._sessionId) {
      Main.sessionMode.disconnect(this._sessionId);
      this._sessionId = null;
    }

    // forge-abk: drop the runtime override-reconcile listeners BEFORE restoring,
    // so a settings write during teardown can't re-enter the reconcile handler.
    if (this._overrideReconcileIds) {
      for (const id of this._overrideReconcileIds) {
        this.settings?.disconnect(id);
      }
      this._overrideReconcileIds = null;
    }
    if (this._kbdReconcileId) {
      this.kbdSettings?.disconnect(this._kbdReconcileId);
      this._kbdReconcileId = null;
    }

    // Restore GNOME settings and keybindings (#461, #288)
    if (this._savedSettings) {
      try {
        for (const saved of this._savedSettings) {
          saved.gsettings.set_value(saved.key, saved.original);
          this._saveOriginal(saved, null);
        }
        Logger.info("Restored GNOME settings and keybindings");
      } catch (e) {
        Logger.warn(`Failed to restore GNOME settings: ${e}`);
      }
      this._savedSettings = null;
      this._gnomeSettings = null;
    }

    this._removeIndicator();
    this.extWm?.disable();
    this.keybindings?.disable();
    this.cheatsheet?.destroy();
    this.configSync?.destroy();
    this.keybindings = null;
    this.cheatsheet = null;
    this.extWm = null;
    this.theme?.unloadStylesheet();
    this.theme = null;
    this.configMgr = null;
    this.configSync = null;
    this.settings = null;
    this.kbdSettings = null;
    // forge-l2f7: clear Logger's module-level settings ref last (all Logger use
    // above still needs it). Counterpart to Logger.init() in enable().
    Logger.destroy();
  }

  _onSessionModeChanged(session) {
    // forge-aggo: check unlock-dialog FIRST. Real GNOME emits the lock screen as
    // {currentMode:"unlock-dialog", parentMode:"user"}, so a leading
    // `parentMode === "user"` test wins on lock and this teardown never runs —
    // leaving keybindings registered and the indicator visible on the lock screen.
    if (session.currentMode === "unlock-dialog") {
      // Keep running on lock screen so the window tree persists in memory; only
      // disable keybindings here (re-enabled on user session). Shutting the whole
      // extension down on lock was rejected under GNOME 45 session-mode review.
      // https://gjs.guide/extensions/review-guidelines/review-guidelines.html#session-modes
      Logger.info("lock-screen on session change");
      this.keybindings?.disable();
      this._removeIndicator();
    } else if (session.currentMode === "user" || session.parentMode === "user") {
      Logger.info("user on session change");
      this._addIndicator();
      this.keybindings?.enable();
    }
  }

  _addIndicator() {
    // Bug #354: repeated "user" session updates must not stack duplicate
    // menu toggles; _removeIndicator nulls this.indicator on lock.
    if (this.indicator) return;
    this.indicator = new FeatureIndicator(this);
    this.indicator.quickSettingsItems.push(new FeatureMenuToggle(this));
    Main.panel.statusArea.quickSettings.addExternalIndicator(this.indicator);
  }

  _removeIndicator() {
    this.indicator?.quickSettingsItems.forEach((item) => item.destroy());
    this.indicator?.destroy();
    this.indicator = null;
  }
}
