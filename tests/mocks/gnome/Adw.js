// Mock Adw (libadwaita) namespace (prefs process only)
import { Widget, Editable, HeaderBar as GtkHeaderBar } from "./Gtk.js";
import { Object as GObjectBase } from "./GObject.js";

export class HeaderBar extends GtkHeaderBar {}

export class PreferencesPage extends Widget {
  add(group) {
    this._addChild(group);
  }
}

export class PreferencesGroup extends Widget {
  add(child) {
    this._addChild(child);
  }

  remove(child) {
    this._removeChild(child);
  }

  set_header_suffix(widget) {
    this.header_suffix = widget;
  }
}

export class PreferencesRow extends Widget {
  get_title() {
    return this.title;
  }
}

export class ActionRow extends PreferencesRow {
  get_subtitle() {
    return this.subtitle;
  }

  add_suffix(widget) {
    this._addChild(widget);
  }
}

export class ExpanderRow extends ActionRow {
  add_row(row) {
    this._addChild(row);
  }
}

// EntryRow is a GtkEditable too, so set_text keeps the equal-text early return.
export class EntryRow extends Editable {
  get_title() {
    return this.title;
  }

  add_suffix(widget) {
    this._addChild(widget);
  }
}

export class Toast extends GObjectBase {
  constructor(params = {}) {
    super();
    Object.assign(this, params);
  }
}

export class AboutWindow extends Widget {
  constructor(params = {}) {
    super(params);
    this.links = [];
  }

  add_link(title, url) {
    this.links.push({ title, url });
  }

  present() {
    this.presented = true;
  }
}

export default {
  HeaderBar,
  PreferencesPage,
  PreferencesGroup,
  PreferencesRow,
  ActionRow,
  ExpanderRow,
  EntryRow,
  Toast,
  AboutWindow,
};
