// theming-config:G015: the windowProps setter dropped _saveJsonConfig's boolean, so a failed
// windows.json write (mkdir failure or throwing replace_contents) looked like a success: the
// Windows page changed its rows and bumped window-overrides-reload-trigger for nothing.
// Fix: ConfigManager.saveWindowProps returns the write result (the setter calls it);
// FloatingPage.saveOverrides toasts and returns false, and Add, Remove and Reset touch their
// rows only on true (Remove saves before removing the row).
import { describe, it, expect, vi, afterEach } from "vitest";
import GLib from "gi://GLib";
import { ConfigManager } from "../../lib/shared/settings.js";
import { FloatingPage } from "../../lib/prefs/floating.js";
import { File, Settings } from "../mocks/gnome/Gio.js";
import { installFileStore } from "../mocks/helpers/index.js";

const USER = "/home/test/.config/forge/config/windows.json";
const DEFAULT = "/mock/config/windows.json";
const rules = (...names) => ({
  overrides: names.map((wmClass) => ({ wmClass, mode: "float" })),
});

afterEach(() => vi.restoreAllMocks());

function setup() {
  const store = installFileStore({
    [USER]: JSON.stringify(rules("Alpha")),
    [DEFAULT]: JSON.stringify(rules("Alpha", "Beta")),
  });
  const settings = new Settings();
  const page = new FloatingPage({ settings, dir: new File("/mock") });
  const toasts = [];
  page._root = { add_toast: (t) => toasts.push(t.title) };
  const trigger = () => settings.get_uint("window-overrides-reload-trigger");
  return { store, settings, page, toasts, trigger };
}

describe("ConfigManager.saveWindowProps", () => {
  it("returns true and writes on success", () => {
    const { store } = setup();
    const mgr = new ConfigManager({ dir: new File("/mock") });
    expect(mgr.saveWindowProps(rules("Gamma"))).toBe(true);
    expect(JSON.parse(store.files.get(USER))).toEqual(rules("Gamma"));
  });

  it("returns false when mkdir fails", () => {
    setup();
    vi.spyOn(GLib, "mkdir_with_parents").mockReturnValue(-1);
    const mgr = new ConfigManager({ dir: new File("/mock") });
    expect(mgr.saveWindowProps(rules("Gamma"))).toBe(false);
  });

  it("returns false when the write throws", () => {
    const { store } = setup();
    store.failWrites();
    const mgr = new ConfigManager({ dir: new File("/mock") });
    expect(mgr.saveWindowProps(rules("Gamma"))).toBe(false);
  });
});

describe("FloatingPage with a failing save", () => {
  it("Add: one toast, no trigger bump, rows unchanged", () => {
    const { store, page, toasts, trigger } = setup();
    store.failWrites();
    const before = trigger();
    const rowsBefore = [...page.rows];
    page.wmClassEntry.set_text("Gamma");
    page.onAddHandler();
    expect(toasts).toEqual(["Could not save the window rules"]);
    expect(trigger()).toBe(before);
    expect(page.rows).toEqual(rowsBefore);
  });

  it("Remove: one toast, no trigger bump, row kept", () => {
    const { store, page, toasts, trigger } = setup();
    store.failWrites();
    const before = trigger();
    const row = page.rows[0];
    page.onRemoveHandler({ wmClass: "Alpha", mode: "float" }, row);
    expect(toasts).toEqual(["Could not save the window rules"]);
    expect(trigger()).toBe(before);
    expect(page.rows).toContain(row);
  });

  it("Reset: one toast, no trigger bump, rows kept", () => {
    const { store, page, toasts, trigger } = setup();
    store.failWrites();
    const before = trigger();
    const rowsBefore = [...page.rows];
    page.onResetHandler();
    expect(toasts).toEqual(["Could not save the window rules"]);
    expect(trigger()).toBe(before);
    expect(page.rows).toEqual(rowsBefore);
  });

  it("a good save still bumps the trigger and edits the rows", () => {
    const { page, toasts, trigger } = setup();
    const before = trigger();
    page.wmClassEntry.set_text("Gamma");
    page.onAddHandler();
    expect(toasts).toEqual([]);
    expect(trigger()).toBe(before + 1);
    expect(page.rows).toHaveLength(2);
  });
});

describe("FloatingPage with a good save", () => {
  it("Add rejects an empty class and a duplicate rule without saving", () => {
    const { store, page, trigger } = setup();
    const before = trigger();
    page.onAddHandler();
    page.wmClassEntry.set_text("Alpha");
    page.onAddHandler();
    expect(trigger()).toBe(before);
    expect(JSON.parse(store.files.get(USER))).toEqual(rules("Alpha"));
  });

  it("Add keeps a title and sorts the new row before a later class", () => {
    const { store, page } = setup();
    page.wmClassEntry.set_text("Aardvark");
    page.wmTitleEntry.set_text("Doc");
    page.onAddHandler();
    expect(page.rows.map((r) => r.get_subtitle())[0]).toBe("Aardvark");
    expect(JSON.parse(store.files.get(USER)).overrides).toContainEqual({
      wmClass: "Aardvark",
      mode: "float",
      wmTitle: "Doc",
    });
  });

  it("Remove drops the row and the rule", () => {
    const { store, page, trigger } = setup();
    const before = trigger();
    const row = page.rows[0];
    page.onRemoveHandler({ wmClass: "Alpha", mode: "float" }, row);
    expect(page.rows).not.toContain(row);
    expect(JSON.parse(store.files.get(USER))).toEqual(rules());
    expect(trigger()).toBe(before + 1);
  });

  it("Reset rebuilds the rows from the bundled default", () => {
    const { store, page } = setup();
    page.onResetHandler();
    expect(page.rows).toHaveLength(2);
    expect(JSON.parse(store.files.get(USER))).toEqual(rules("Alpha", "Beta"));
  });
});
