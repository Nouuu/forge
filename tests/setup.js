// Register global mocks before tests run
import { vi } from "vitest";
import * as GnomeMocks from "./mocks/gnome/index.js";

// Mock the gi:// import scheme used by GNOME Shell ESM
// The extension uses: import Meta from "gi://Meta"
vi.mock("gi://Meta", () => GnomeMocks.Meta);
vi.mock("gi://Gio", () => GnomeMocks.Gio);
vi.mock("gi://GLib", () => GnomeMocks.GLib);
vi.mock("gi://Shell", () => GnomeMocks.Shell);
vi.mock("gi://St", () => GnomeMocks.St);
vi.mock("gi://Clutter", () => GnomeMocks.Clutter);
vi.mock("gi://GObject", () => GnomeMocks.GObject);

// Create shared mock objects that tests can modify
// Using vi.hoisted() ensures these are created before mocks and are mutable
const { mockOverview, mockWm, mockPanel, mockSessionMode } = vi.hoisted(() => {
  return {
    mockOverview: {
      visible: false,
      connect: (signal, callback) => Math.random(),
      disconnect: (id) => {},
      _signals: {},
    },
    mockWm: {
      addKeybinding: () => {},
      removeKeybinding: () => {},
      allowKeybinding: () => {},
    },
    mockPanel: {
      statusArea: {
        quickSettings: {
          addExternalIndicator: () => {},
        },
      },
    },
    // The quick-settings menu hides its Settings action on the lock screen.
    mockSessionMode: {
      allowSettings: true,
      currentMode: "user",
      isLocked: false,
    },
  };
});

// Mock GNOME Shell resources
vi.mock("resource:///org/gnome/shell/misc/config.js", () => ({
  PACKAGE_VERSION: "47.0",
}));

vi.mock("resource:///org/gnome/shell/extensions/extension.js", () => ({
  Extension: class Extension {
    constructor() {
      this.metadata = {};
      this.dir = { get_path: () => "/mock/path" };
    }
    getSettings() {
      return GnomeMocks.Gio.Settings.new();
    }
  },
  gettext: (str) => str,
}));

vi.mock("resource:///org/gnome/shell/ui/main.js", () => ({
  overview: mockOverview,
  wm: mockWm,
  panel: mockPanel,
  sessionMode: mockSessionMode,
  notify: () => {},
}));

// Quick Settings widgets (lib/extension/indicator.js). GNOME's real classes are
// St/Clutter actors; these keep just the surface the indicator touches — the menu
// API, the indicator slot, and enough of a GObject base for registerClass.
vi.mock("resource:///org/gnome/shell/ui/quickSettings.js", () => ({
  QuickMenuToggle: class QuickMenuToggle extends GnomeMocks.GObject.Object {
    constructor(params = {}) {
      super();
      Object.assign(this, params);
      this.menu = {
        _settingsActions: {},
        _items: [],
        setHeader: (icon, title, subtitle) => {
          this.menu._header = { icon, title, subtitle };
        },
        addMenuItem: (item) => this.menu._items.push(item),
        addAction: (label, callback) => {
          const item = { label, callback, visible: true };
          this.menu._items.push(item);
          return item;
        },
      };
    }
  },
  SystemIndicator: class SystemIndicator extends GnomeMocks.GObject.Object {
    constructor() {
      super();
      this.quickSettingsItems = [];
      this._indicators = [];
    }
    _addIndicator() {
      const indicator = new GnomeMocks.St.Icon();
      this._indicators.push(indicator);
      return indicator;
    }
    destroy() {
      this._destroyed = true;
    }
  },
}));

vi.mock("resource:///org/gnome/shell/ui/popupMenu.js", () => ({
  PopupSwitchMenuItem: class PopupSwitchMenuItem extends GnomeMocks.GObject.Object {
    constructor(title, active) {
      super();
      this.label = title;
      this.state = active;
    }
    // The real widget updates the switch WITHOUT re-emitting 'toggled'.
    setToggleState(state) {
      this.state = state;
    }
  },
  PopupSeparatorMenuItem: class PopupSeparatorMenuItem extends GnomeMocks.GObject.Object {},
}));

// Also set global.Main to use the same overview object reference
global.Main = {
  overview: mockOverview,
  wm: mockWm,
  panel: mockPanel,
  sessionMode: mockSessionMode,
  notify: () => {},
};

// Mock Extension class for extension.js
global.Extension = class Extension {
  constructor() {
    this.metadata = {};
    this.dir = { get_path: () => "/mock/path" };
  }
  getSettings() {
    return GnomeMocks.Gio.Settings.new();
  }
};

// Mock global.window_group for GNOME Shell
global.window_group = {
  _children: [],
  contains: function (child) {
    return this._children.includes(child);
  },
  add_child: function (child) {
    if (!this._children.includes(child)) {
      this._children.push(child);
    }
  },
  remove_child: function (child) {
    const index = this._children.indexOf(child);
    if (index !== -1) {
      this._children.splice(index, 1);
    }
  },
};

// Mock global.stage for GNOME Shell
global.stage = {
  get_width: () => 1920,
  get_height: () => 1080,
};
