// Mock Gtk 4 namespace (prefs process only)
import { Object as GObjectBase } from "./GObject.js";

export const Align = { FILL: 0, START: 1, END: 2, CENTER: 3, BASELINE: 4 };
export const Orientation = { HORIZONTAL: 0, VERTICAL: 1 };
export const License = { GPL_3_0: 7 };
export const DialogError = { FAILED: 0, CANCELLED: 1, DISMISSED: 2 };

// A GObject property write: notify::<name> fires synchronously, and only on a real change.
function setProp(obj, name, value) {
  if (obj[name] === value) return;
  obj[`_${name}`] = value;
  obj.emit(`notify::${name}`, obj);
}

export class Widget extends GObjectBase {
  constructor(params = {}) {
    super();
    this._children = [];
    this._parent = null;
    this._css = [];
    this.visible = true;
    Object.assign(this, params);
  }

  set_visible(value) {
    this.visible = value;
  }

  get css_classes() {
    return this._css;
  }

  set css_classes(list) {
    this._css = [...list];
  }

  set_css_classes(list) {
    this.css_classes = list;
  }

  get_css_classes() {
    return this._css;
  }

  add_css_class(name) {
    if (!this._css.includes(name)) this._css.push(name);
  }

  remove_css_class(name) {
    this._css = this._css.filter((c) => c !== name);
  }

  set_tooltip_text(text) {
    this.tooltip_text = text;
  }

  set_tooltip_markup(text) {
    this.tooltip_markup = text;
  }

  _addChild(child) {
    child._parent = this;
    this._children.push(child);
  }

  _removeChild(child) {
    this._children = this._children.filter((c) => c !== child);
    child._parent = null;
  }

  get_first_child() {
    return this._children[0] ?? null;
  }

  get_next_sibling() {
    return this._parent?._children[this._parent._children.indexOf(this) + 1] ?? null;
  }

  // Test hook: a root is set by hand, and a widget without one asks its parent.
  _setRoot(root) {
    this._root = root;
  }

  get_root() {
    return this._root ?? this._parent?.get_root() ?? null;
  }

  // The base unroot only chains up; a test calls it to model the window closing.
  vfunc_unroot() {}
}

export class Box extends Widget {
  append(child) {
    this._addChild(child);
  }
}

export class Switch extends Widget {
  get active() {
    return this._active ?? false;
  }

  set active(value) {
    setProp(this, "active", value);
  }
}

export class Image extends Widget {}

export class Label extends Widget {
  get label() {
    return this._label;
  }

  set label(value) {
    setProp(this, "label", value);
  }
}

export class Button extends Widget {}

export class ToggleButton extends Button {
  get active() {
    return this._active ?? false;
  }

  set active(value) {
    setProp(this, "active", value);
  }
}

export class ColorButton extends Widget {
  get_rgba() {
    return this.rgba;
  }

  // set_rgba does not emit color-set: only a user pick does.
  set_rgba(rgba) {
    this.rgba = rgba;
  }
}

export class SpinButton extends Widget {
  static new_with_range(low, high, step) {
    const spin = new SpinButton();
    Object.assign(spin, { _low: low, _high: high, step, _value: low });
    return spin;
  }

  get value() {
    return this._value;
  }

  // new_with_range builds a clamping adjustment; value-changed and notify::value fire only
  // on a real change of the clamped value (forge-ljo8).
  set value(want) {
    const next = Math.min(this._high, Math.max(this._low, want));
    if (next === this._value) return;
    this._value = next;
    this.emit("value-changed", this);
    this.emit("notify::value", this);
  }
}

export class StringList extends GObjectBase {
  constructor() {
    super();
    this.items = [];
  }

  append(item) {
    this.items.push(item);
  }

  get_n_items() {
    return this.items.length;
  }
}

export class DropDown extends Widget {
  get selected() {
    return this._selected ?? 0;
  }

  // notify::selected fires synchronously and only on change (forge-cypb, forge-egnf).
  set selected(index) {
    setProp(this, "selected", index);
  }
}

export class Editable extends Widget {
  get_text() {
    return this._text ?? "";
  }

  // GtkText returns early on equal text, so no `changed` (forge-4u58).
  set_text(text) {
    if (text === this.get_text()) return;
    this._text = text;
    this.emit("changed", this);
  }
}

export class SearchEntry extends Editable {}

export class HeaderBar extends Widget {
  pack_end(child) {
    this._addChild(child);
  }
}

// Like GIO, launch calls back after it returns; launch_finish throws a failure (GLib.Error).
export class FileLauncher extends GObjectBase {
  launch(_parent, _cancellable, callback) {
    queueMicrotask(() => callback?.(this, {}));
  }

  launch_finish(_result) {
    return true;
  }
}

const iconTheme = { add_search_path() {} };
export const IconTheme = { get_for_display: () => iconTheme };

const MODS = { Shift: 1, Control: 4, Alt: 8, Super: 1 << 26 };

export function accelerator_parse(accel) {
  const m = /^((?:<\w+>)*)(\w)$/.exec(accel);
  if (!m) return [false, 0, 0];
  const mods = [...m[1].matchAll(/<(\w+)>/g)].reduce((acc, [, name]) => acc | (MODS[name] ?? 0), 0);
  return [true, m[2].charCodeAt(0), mods];
}

export function accelerator_valid(key, _mods) {
  return key !== 0;
}

export function accelerator_name(key, mods) {
  const prefix = Object.entries(MODS)
    .filter(([, bit]) => mods & bit)
    .map(([name]) => `<${name}>`)
    .join("");
  return prefix + String.fromCharCode(key);
}

export default {
  Align,
  Orientation,
  License,
  DialogError,
  Widget,
  Box,
  Switch,
  Image,
  Label,
  Button,
  ToggleButton,
  ColorButton,
  SpinButton,
  StringList,
  DropDown,
  Editable,
  SearchEntry,
  HeaderBar,
  FileLauncher,
  IconTheme,
  accelerator_parse,
  accelerator_valid,
  accelerator_name,
};
