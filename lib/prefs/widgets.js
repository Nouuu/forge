/** @license (c) aylur. GPL v3 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";

import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { Logger } from "../shared/logger.js";

export class PreferencesPage extends Adw.PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  /**
   * @param {{ title: string, description?: string, children: any[], header_suffix?: import('gi://Gtk').default.Widget | null }} opts
   */
  add_group({ title, description = "", children, header_suffix = null }) {
    const group = new Adw.PreferencesGroup({ title, description });
    for (const child of children) group.add(child);
    if (header_suffix) group.set_header_suffix(header_suffix);
    this.add(group);
    return group;
  }
}

export class SwitchRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  constructor({ title, settings, bind, subtitle = "", experimental = false }) {
    super({ title, subtitle });
    const gswitch = new Gtk.Switch({
      active: settings.get_boolean(bind),
      valign: Gtk.Align.CENTER,
    });
    settings.bind(bind, gswitch, "active", Gio.SettingsBindFlags.DEFAULT);
    if (experimental) {
      const icon = new Gtk.Image({ icon_name: "bug-symbolic" });
      icon.set_tooltip_markup(
        _("<b>CAUTION</b>: Enabling this setting can lead to bugs or cause the shell to crash")
      );
      this.add_suffix(icon);
    }
    this.add_suffix(gswitch);
    this.activatable_widget = gswitch;
  }
}

export class ColorRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  constructor({ title, init, onChange, subtitle = "" }) {
    super({ title, subtitle });
    let rgba = new Gdk.RGBA();
    // forge-el84: `init` is undefined when the user's stylesheet is missing the
    // rule or the declaration (getCssProperty returns {}). Gdk.RGBA.parse takes a
    // non-nullable const char*, so GJS THROWS rather than returning false — and
    // the throw escaped AppearancePage's constructor into fillPreferencesWindow,
    // taking Appearance, Keyboard, Windows and Portability out of the prefs
    // window. An unparsed RGBA is transparent black, a valid button state.
    if (typeof init === "string") rgba.parse(init);
    this.colorButton = new Gtk.ColorButton({ rgba, use_alpha: true, valign: Gtk.Align.CENTER });
    this.colorButton.connect("color-set", () => {
      onChange(this.colorButton.get_rgba().to_string());
    });
    this.add_suffix(this.colorButton);
    this.activatable_widget = this.colorButton;
  }
}

export class SpinButtonRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {[number, number, number]} opts.range
   * @param {string} [opts.subtitle]
   * @param {number | string} [opts.init] numeric seed; CSS-derived callers pass a numeric string
   * @param {(value: number) => void} [opts.onChange]
   * @param {number} [opts.max_width_chars]
   * @param {number} [opts.max_length]
   * @param {number} [opts.width_chars]
   * @param {number} [opts.xalign]
   * @param {Gio.Settings} [opts.settings]
   * @param {string} [opts.bind]
   */
  constructor({
    title,
    range: [low, high, step],
    subtitle = "",
    init = undefined,
    onChange = undefined,
    max_width_chars = undefined,
    max_length = undefined,
    width_chars = undefined,
    xalign = undefined,
    settings = undefined,
    bind = undefined,
  }) {
    super({ title, subtitle });
    const gspin = Gtk.SpinButton.new_with_range(low, high, step);
    gspin.xalign = 1;
    // forge-ljo8: Gtk.SpinButton.new_with_range() builds a clamping adjustment, so
    // seeding a value outside [low, high] silently lands on the bound instead. Track
    // that, because the eager reconcile below would then write the CLAMPED value
    // back over the user's source of truth.
    let seedClamped = false;
    if (bind && settings) {
      settings.bind(bind, gspin, "value", Gio.SettingsBindFlags.DEFAULT);
    } else if (init !== undefined) {
      const want = Number(init);
      gspin.value = want;
      seedClamped = Number.isFinite(want) && gspin.value !== want;
    }
    if (onChange) {
      gspin.connect("value-changed", (widget) => onChange(widget.value));
      // Reconcile the stylesheet with the persisted/init value once. Bind/seed
      // ran above, so this does not fire during the construction sync. Safe to
      // run on every prefs open because setCssProperty is idempotent (forge-w3ss)
      // — but only while the widget still agrees with the source value. When the
      // seed was clamped they disagree, and firing would rewrite a hand-edited
      // `border-width: 8px` down to the row's max just from opening the page
      // (forge-ljo8). Skip it; the user's own edit stays authoritative until they
      // actually touch the control.
      if (!seedClamped) onChange(gspin.value);
    }
    this.add_suffix(gspin);
    this.set_css_classes(["spin"]);
    this.activatable_widget = gspin;
  }
}

export class DropDownRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  /**
   * @type {string}
   * Name of the gsetting key to bind to
   */
  bind;

  selected = 0;

  /** @type {{name: string; id: string}[]} */
  items;

  model = new Gtk.StringList();

  /** @type {Gtk.DropDown} */
  dropdown;

  constructor({ title, settings, bind, items, subtitle = "" }) {
    super({ title, subtitle });
    this.settings = settings;
    this.items = items;
    this.bind = bind;
    this.#build();
    this.add_suffix(this.dropdown);
    this.add_suffix(
      iconButton({
        icon: "edit-undo-symbolic",
        tooltip: _("Reset to default"),
        onClick: () => {
          settings.reset(bind);
          this.reset();
        },
      })
    );

    // forge-cypb: this row read its gsetting once at construction, so an
    // external write (Portability -> Import) left it showing the pre-import
    // value. #syncing gates #onSelected: assigning dropdown.selected emits
    // notify::selected, and when the external value is not in `items`
    // #currentIndex() falls back to 0 — writing items[0].id straight back over
    // the value we were told about (the forge-egnf clobber).
    this._settingsChangedId = settings.connect(`changed::${bind}`, () => {
      const idx = this.#currentIndex();
      if (idx === this.dropdown.selected) return;
      this.#syncing = true;
      try {
        this.selected = idx;
        this.dropdown.selected = idx;
      } finally {
        this.#syncing = false;
      }
    });
  }

  vfunc_unroot() {
    if (this._settingsChangedId) {
      this.settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    super.vfunc_unroot();
  }

  reset() {
    // The reset button has already restored the gschema default into GSettings; select
    // the item matching that value instead of forcing index 0, which silently
    // wrote items[0].id over the just-restored default (forge-egnf).
    const idx = this.#currentIndex();
    this.selected = idx;
    this.dropdown.selected = idx;
  }

  #build() {
    for (const { name } of this.items) {
      this.model.append(name);
    }
    this.selected = this.#currentIndex();
    const { model, selected } = this;
    this.dropdown = new Gtk.DropDown({ valign: Gtk.Align.CENTER, model, selected });
    this.dropdown.connect("notify::selected", () => this.#onSelected());
    this.activatable_widget = this.dropdown;
  }

  /** Index of the item whose id equals the current GSetting value, else 0. */
  #currentIndex() {
    const cur = this.#get();
    const idx = this.items.findIndex((x) => x.id === cur);
    return idx >= 0 ? idx : 0;
  }

  #syncing = false;

  #onSelected() {
    if (this.#syncing) return;
    this.selected = this.dropdown.selected;
    const { id } = this.items[this.selected];
    Logger.debug("setting", id, this.selected);
    this.#set(this.bind, id);
  }

  /**
   * @param {string} x
   */
  #get(x = this.bind) {
    return this.settings.get_value(x).recursiveUnpack();
  }

  /**
   * @param {string} x
   * @param {unknown} y
   */
  #set(x, y) {
    const typeString = this.settings.get_value(x).get_type_string();
    return this.settings.set_value(x, new GLib.Variant(typeString, y));
  }
}

/**
 * A flat circular icon button for a row suffix.
 * @param {object} opts
 * @param {string} opts.icon
 * @param {string} opts.tooltip
 * @param {() => void} opts.onClick
 */
export function iconButton({ icon, tooltip, onClick }) {
  const button = new Gtk.Button({
    icon_name: icon,
    tooltip_text: tooltip,
    css_classes: ["flat", "circular"],
    valign: Gtk.Align.CENTER,
  });
  button.connect("clicked", () => onClick());
  return button;
}

export class EntryRow extends Adw.EntryRow {
  static {
    GObject.registerClass(this);
  }

  static DEBOUNCE_MS = 1000;

  /** @type {number | null} */
  _saveSourceId = null;

  /** @type {number | null} */
  _settingsChangedId = null;

  /**
   * @typedef {object} EntryMap
   * @property {(settings: Gio.Settings, bind: string) => string} from
   * @property {(settings: Gio.Settings, bind: string, value: string) => boolean} to
   * @property {(settings: Gio.Settings, bind: string) => (string | null)} [warn]
   */

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {Gio.Settings} opts.settings
   * @param {string} opts.bind
   * @param {EntryMap} [opts.map]
   */
  constructor({ title, settings, bind, map = undefined }) {
    super({ title });
    let initialized = false;
    this._saveSourceId = null;

    const save = () => {
      const text = this.get_text();
      if (typeof text === "string") {
        let valid = true;
        if (map) {
          valid = map.to(settings, bind, text) !== false;
        } else {
          settings.set_string(bind, text);
        }
        const root = /** @type {Adw.PreferencesWindow | null} */ (this.get_root());
        if (valid) {
          this.remove_css_class("error");
          // A saved-but-conflicting value (e.g. a keybinding already bound
          // elsewhere) is surfaced, not rejected: keep the value, flag the row
          // with a "warning" class + tooltip so the user can resolve it. Other
          // rows use no warn hook and fall through to the normal "Saved" toast.
          const warning = map?.warn ? map.warn(settings, bind) : null;
          if (warning) {
            this.add_css_class("warning");
            this.set_tooltip_text(warning);
            if (root?.add_toast) {
              root.add_toast(new Adw.Toast({ title: warning, timeout: 3 }));
            }
          } else {
            this.remove_css_class("warning");
            this.set_tooltip_text(null);
            if (root?.add_toast) {
              root.add_toast(new Adw.Toast({ title: _("Saved"), timeout: 1 }));
            }
          }
        } else {
          this.add_css_class("error");
          if (root?.add_toast) {
            root.add_toast(new Adw.Toast({ title: _("Invalid input"), timeout: 2 }));
          }
        }
      }
    };

    /** Run save() now instead of waiting out the debounce. */
    const flush = () => {
      if (this._saveSourceId) {
        GLib.source_remove(this._saveSourceId);
        this._saveSourceId = null;
      }
      save();
    };

    this.connect("changed", () => {
      if (!initialized) {
        initialized = true;
        return;
      }
      // forge-cypb: `initialized` cannot double as the resync guard — it is
      // consumed by the first set_text below and stays true forever after, so a
      // programmatic re-seed would schedule a debounce and write straight back.
      if (this._syncing) return;
      if (this._saveSourceId) {
        GLib.source_remove(this._saveSourceId);
      }
      this._saveSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, EntryRow.DEBOUNCE_MS, () => {
        save();
        this._saveSourceId = null;
        return GLib.SOURCE_REMOVE;
      });
    });

    // forge-dhyz: the Keyboard page tells the user "to apply a shortcut press
    // enter", but nothing implemented it — the only save path was the 1s
    // debounce, which vfunc_unroot CANCELS on window close. Editing a shortcut
    // and closing prefs within a second silently discarded it, after an explicit
    // (false) confirmation cue.
    this.connect("entry-activated", flush);

    const readCurrent = () => (map ? map.from(settings, bind) : settings.get_string(bind)) ?? "";

    // forge-cypb: this row used to read its gsetting exactly once. Keyboard's
    // "Disable All"/"Restore Defaults" and Portability's Import all write the
    // keys directly, so every built row kept displaying its stale value — and
    // appending to a stale field wrote the OLD accel back, silently restoring a
    // binding the user had just disabled.
    this._settingsChangedId = settings.connect(`changed::${bind}`, () => {
      const value = readCurrent();
      if (value === this.get_text()) return;
      this._syncing = true;
      try {
        if (this._saveSourceId) {
          GLib.source_remove(this._saveSourceId);
          this._saveSourceId = null;
        }
        this.set_text(value);
        this.remove_css_class("error");
        this.remove_css_class("warning");
        this.set_tooltip_text(null);
      } finally {
        this._syncing = false;
      }
    });

    this._settings = settings;
    this.set_text(readCurrent());
    // forge-4u58: the `changed` swallow above assumes this seed emits a `changed`
    // to consume — but set_text("") on an already-empty buffer (empty-default
    // settings like workspace-skip-tile) emits none, so `initialized` would stay
    // false and swallow the user's first real keystroke, silently dropping a
    // single-token value. Arm the flag deterministically rather than via the signal.
    initialized = true;
    this.add_suffix(
      iconButton({
        icon: "edit-clear-symbolic",
        tooltip: _("Clear shortcut"),
        onClick: () => this.set_text(""),
      })
    );
    this.add_suffix(
      iconButton({
        icon: "edit-undo-symbolic",
        tooltip: _("Reset to default"),
        onClick: () => {
          settings.reset(bind);
          this.set_text(readCurrent());
        },
      })
    );
  }

  vfunc_unroot() {
    // Cancel a pending debounced save so the timeout can't fire save() — which
    // calls get_text()/get_root() — on a finalized widget after the prefs window
    // closes (forge-3qj3). unroot (not unmap) is used so collapsing an
    // ExpanderRow, which only unmaps its rows, doesn't drop a live edit.
    if (this._saveSourceId) {
      GLib.source_remove(this._saveSourceId);
      this._saveSourceId = null;
    }
    // forge-cypb: release the resync handler with the widget.
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    super.vfunc_unroot();
  }
}

export class RadioRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  static orientation = Gtk.Orientation.HORIZONTAL;

  static spacing = 3;

  static valign = Gtk.Align.CENTER;

  constructor({ title, subtitle = "", settings, bind, options }) {
    super({ title, subtitle });
    const current = settings.get_string(bind);
    const labels = Object.fromEntries(Object.entries(options).map(([k, v]) => [v, k]));
    const { orientation, spacing, valign } = RadioRow;
    const hbox = new Gtk.Box({ orientation, spacing, valign });
    const toggles = [];
    let group;
    for (const [key, label] of Object.entries(options)) {
      const toggle = new Gtk.ToggleButton({ label, ...(group && { group }) });
      group ||= toggle;
      toggle.active = key === current;
      toggle.set_css_classes(["flat"]);
      toggle.connect("clicked", () => {
        if (toggle.active) {
          settings.set_string(bind, labels[toggle.label]);
        }
      });
      toggles.push([key, toggle]);
      hbox.append(toggle);
    }
    this.add_suffix(hbox);

    // forge-cypb: read-once like the other rows, so Portability -> Import left
    // mod-mask-mouse-tile showing the pre-import value. No resync guard is
    // needed here: GTK4's set_active() emits `toggled`, not `clicked`, so the
    // write-back handler above cannot re-fire.
    this._settings = settings;
    this._settingsChangedId = settings.connect(`changed::${bind}`, () => {
      const value = settings.get_string(bind);
      for (const [key, toggle] of toggles) toggle.active = key === value;
    });
  }

  vfunc_unroot() {
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    super.vfunc_unroot();
  }
}

export class RemoveItemRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} [opts.subtitle]
   * @param {(item: any, parent: any) => void} [opts.onRemove]
   */
  constructor({ title, subtitle = "", onRemove = undefined }) {
    super({ title, subtitle });
    this.add_suffix(
      iconButton({
        icon: "edit-delete-symbolic",
        tooltip: _("Remove Item"),
        onClick: () => onRemove?.(subtitle, this),
      })
    );
  }
}
