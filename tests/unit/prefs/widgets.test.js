// prefs-lifecycle:G003: pins the bug-fix guards of lib/prefs/widgets.js, one describe per
// forge id. Each test was shown red under the mutation named in the comment above it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import {
  ColorRow,
  DropDownRow,
  EntryRow,
  RadioRow,
  SpinButtonRow,
} from "../../../lib/prefs/widgets.js";

let timeoutAdd;
let sourceRemove;

beforeEach(() => {
  timeoutAdd = vi.spyOn(GLib, "timeout_add").mockImplementation(() => 42);
  sourceRemove = vi.spyOn(GLib, "source_remove");
});

afterEach(() => vi.restoreAllMocks());

// The settings mock's set_* does not emit; an external write is emitted by hand.
const external = (settings, key, value) => {
  settings.set_string(key, value);
  settings.emit(`changed::${key}`);
};

const entryRow = (value = "") => {
  const settings = Gio.Settings.new("x");
  if (value) settings.set_string("k", value);
  return { settings, row: new EntryRow({ title: "e", settings, bind: "k" }) };
};

describe("forge-4u58: first keystroke on an empty key", () => {
  // Mutation: drop the post-seed `initialized = true` in EntryRow.
  it("schedules a save", () => {
    const { row } = entryRow();
    row.set_text("1");
    expect(timeoutAdd).toHaveBeenCalledTimes(1);
  });
});

describe("forge-dhyz: entry-activated flushes", () => {
  // Mutation: drop `this.connect("entry-activated", flush)`.
  it("writes the key now and removes the pending source", () => {
    const { settings, row } = entryRow();
    row.set_text("<Super>a");
    expect(settings.get_string("k")).toBe("");
    row.emit("entry-activated");
    expect(settings.get_string("k")).toBe("<Super>a");
    expect(sourceRemove).toHaveBeenCalledWith(42);
    expect(row._saveSourceId).toBeNull();
  });
});

describe("forge-3qj3: unroot cancels the pending save", () => {
  // Mutation: drop `GLib.source_remove` in EntryRow.vfunc_unroot.
  it("removes the debounce id", () => {
    const { row } = entryRow();
    row.set_text("a");
    row.vfunc_unroot();
    expect(sourceRemove).toHaveBeenCalledWith(42);
    expect(row._saveSourceId).toBeNull();
  });
});

describe("forge-cypb: EntryRow resync", () => {
  // Mutation: drop `if (this._syncing) return;` in the EntryRow changed handler.
  it("shows an external change without scheduling a save, and clears error and warning", () => {
    const { settings, row } = entryRow("old");
    row.add_css_class("error");
    row.add_css_class("warning");
    external(settings, "k", "new");
    expect(row.get_text()).toBe("new");
    expect(timeoutAdd).not.toHaveBeenCalled();
    expect(row.get_css_classes()).toEqual([]);
  });

  // Mutation: drop the disconnect in EntryRow.vfunc_unroot.
  it("drops its handler on unroot", () => {
    const { settings, row } = entryRow();
    expect(settings.getHandlerCount("changed::k")).toBe(1);
    row.vfunc_unroot();
    expect(settings.getHandlerCount("changed::k")).toBe(0);
  });
});

describe("forge-cypb and forge-egnf: DropDownRow", () => {
  const items = [
    { name: "Top", id: "top" },
    { name: "Bottom", id: "bottom" },
  ];
  const build = (value) => {
    const settings = Gio.Settings.new("x");
    settings.set_string("k", value);
    return { settings, row: new DropDownRow({ title: "d", settings, bind: "k", items }) };
  };

  // Mutation: drop `this.#syncing = true` in the DropDownRow resync.
  it("an external value outside items selects 0 without writing it back", () => {
    const { settings, row } = build("bottom");
    expect(row.dropdown.selected).toBe(1);
    external(settings, "k", "weird");
    expect(row.dropdown.selected).toBe(0);
    expect(settings.get_string("k")).toBe("weird");
  });

  // Mutation: force index 0 in DropDownRow.reset().
  it("reset selects the restored default, not index 0", () => {
    const { settings, row } = build("top");
    vi.spyOn(settings, "reset").mockImplementation(() => settings.set_string("k", "bottom"));
    const button = row._children.find((c) => c.icon_name === "edit-undo-symbolic");
    button.emit("clicked");
    expect(row.dropdown.selected).toBe(1);
    expect(settings.get_string("k")).toBe("bottom");
  });

  // Mutation: drop the disconnect in DropDownRow.vfunc_unroot.
  it("drops its handler on unroot", () => {
    const { settings, row } = build("top");
    row.vfunc_unroot();
    expect(settings.getHandlerCount("changed::k")).toBe(0);
  });
});

describe("forge-ljo8: SpinButtonRow seed clamp", () => {
  // Mutation: drop `if (!seedClamped)` before the reconcile `onChange`.
  it("never reports a clamped seed", () => {
    const onChange = vi.fn();
    new SpinButtonRow({ title: "s", range: [1, 6, 1], init: "8", onChange });
    expect(onChange).not.toHaveBeenCalled();
  });

  // Mutation: drop the reconcile `onChange(gspin.value)`.
  it("reports an in-range seed once", () => {
    const onChange = vi.fn();
    new SpinButtonRow({ title: "s", range: [1, 6, 1], init: "3", onChange });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(3);
  });
});

describe("forge-el84: ColorRow without a stylesheet value", () => {
  // Mutation: drop `if (typeof init === "string")` before `rgba.parse`.
  it("does not throw on an undefined init", () => {
    expect(() => new ColorRow({ title: "c", init: undefined, onChange: vi.fn() })).not.toThrow();
  });
});

describe("forge-cypb: RadioRow resync", () => {
  const build = () => {
    const settings = Gio.Settings.new("x");
    settings.set_string("k", "a");
    const row = new RadioRow({ title: "r", settings, bind: "k", options: { a: "A", b: "B" } });
    return { settings, row, toggles: row._children[0]._children };
  };

  // Mutation: drop the toggle loop in the RadioRow changed handler.
  it("an external change toggles the matching button without a write", () => {
    const { settings, toggles } = build();
    settings.set_string("k", "b");
    const write = vi.spyOn(settings, "set_string");
    settings.emit("changed::k");
    expect(toggles.map((t) => t.active)).toEqual([false, true]);
    expect(write).not.toHaveBeenCalled();
  });

  // Mutation: drop the disconnect in RadioRow.vfunc_unroot.
  it("drops its handler on unroot", () => {
    const { settings, row } = build();
    row.vfunc_unroot();
    expect(settings.getHandlerCount("changed::k")).toBe(0);
  });
});
