// T002 (close-spec-gaps): the Gtk, Adw and Gdk mocks must keep the GTK behaviours that
// shipped lib/prefs guards depend on (forge-4u58, ljo8, cypb, egnf, el84, ijl3).
import { describe, it, expect, vi } from "vitest";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import { SpinButtonRow, EntryRow } from "../../../lib/prefs/widgets.js";

describe("Gtk, Adw and Gdk mock fidelity", () => {
  it("set_text with equal text emits no changed, a different text emits once", () => {
    for (const entry of [new Adw.EntryRow({ title: "t" }), new Gtk.SearchEntry()]) {
      const changed = vi.fn();
      entry.connect("changed", changed);
      entry.set_text("");
      expect(changed).not.toHaveBeenCalled();
      entry.set_text("a");
      entry.set_text("a");
      expect(changed).toHaveBeenCalledTimes(1);
      expect(entry.get_text()).toBe("a");
    }
  });

  it("SpinButton.new_with_range clamps and notifies only on a real change", () => {
    const spin = Gtk.SpinButton.new_with_range(1, 6, 1);
    const changed = vi.fn();
    const notify = vi.fn();
    spin.connect("value-changed", changed);
    spin.connect("notify::value", notify);
    spin.value = 8;
    expect(spin.value).toBe(6);
    spin.value = 6;
    spin.value = 0;
    expect(spin.value).toBe(1);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("DropDown.selected notifies synchronously, only on change", () => {
    const dropdown = new Gtk.DropDown({});
    const seen = [];
    dropdown.connect("notify::selected", () => seen.push(dropdown.selected));
    dropdown.selected = 0;
    dropdown.selected = 2;
    expect(seen).toEqual([2]);
    dropdown.selected = 2;
    expect(seen).toEqual([2]);
  });

  it("Gdk.RGBA.parse throws on a non-string and returns a boolean on a string", () => {
    const rgba = new Gdk.RGBA();
    expect(() => rgba.parse(undefined)).toThrow();
    expect(() => rgba.parse(null)).toThrow();
    expect(rgba.parse("bogus")).toBe(false);
    expect(rgba.parse("rgb(255,0,0)")).toBe(true);
    expect(rgba.to_string()).toBe("rgb(255,0,0)");
    const half = rgba.copy();
    half.alpha = 0.5;
    expect(half.to_string()).toBe("rgba(255,0,0,0.5)");
    expect(rgba.alpha).toBe(1);
  });

  it("vfunc_unroot is a no-op on the base", () => {
    expect(() => new Adw.ActionRow({ title: "t" }).vfunc_unroot()).not.toThrow();
  });

  it("get_root returns the root a test set, through the parent chain", () => {
    const row = new Adw.ActionRow({ title: "t" });
    const button = new Gtk.Button({});
    row.add_suffix(button);
    expect(button.get_root()).toBeNull();
    const win = { add_toast: vi.fn() };
    row._setRoot(win);
    expect(button.get_root()).toBe(win);
  });

  it("tree walk reaches a header bar through get_first_child and get_next_sibling", () => {
    const box = new Gtk.Box({});
    const bar = new Adw.HeaderBar({});
    box.append(new Gtk.Label({}));
    box.append(bar);
    expect(box.get_first_child().get_next_sibling()).toBe(bar);
    expect(bar.get_next_sibling()).toBeNull();
  });
});

describe("Gio.Settings additions", () => {
  it("bind pushes a number as a number into a SpinButton", () => {
    const settings = Gio.Settings.new("x");
    settings.set_int("n", 4);
    const spin = Gtk.SpinButton.new_with_range(1, 6, 1);
    settings.bind("n", spin, "value", Gio.SettingsBindFlags.DEFAULT);
    expect(spin.value).toBe(4);
  });

  it("set_value returns true and reset drops the stored value", () => {
    const settings = Gio.Settings.new("x");
    expect(settings.set_value("k", 1)).toBe(true);
    settings.reset("k");
    expect(settings.list_keys()).not.toContain("k");
  });
});

describe("lib/prefs imports under the mocks", () => {
  it("builds a SpinButtonRow and an EntryRow", () => {
    const settings = Gio.Settings.new("x");
    const spin = new SpinButtonRow({ title: "s", range: [1, 6, 1], init: 3 });
    expect(spin.activatable_widget.value).toBe(3);
    const row = new EntryRow({ title: "e", settings, bind: "k" });
    expect(row.get_text()).toBe("");
  });
});
