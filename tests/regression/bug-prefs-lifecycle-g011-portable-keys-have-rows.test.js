import { describe, it, expect, afterEach, vi } from "vitest";
import { Settings } from "../mocks/gnome/Gio.js";

/**
 * prefs-lifecycle:G011 / theming-config:G004: resize-amount, auto-unmaximize-for-tiling
 * and logging-enabled are portable settings keys that had no control in the preferences,
 * so the only way to change them was the dconf editor or an imported settings.json.
 *
 * Fix: a switch for auto-unmaximize-for-tiling after "New window placement", a spin
 * button (1-100) for resize-amount on the Keyboard page, and a logging-enabled switch in
 * the dev-only Logger group (a shipped build keeps the logger off, so a switch there
 * would do nothing).
 *
 * close-spec-gaps:N09: the switch subtitle said a maximized window is unmaximized before
 * it joins the tiling tree, but handleUnmaximizeForTiling unmaximizes the OTHER maximized
 * windows of the monitor when a new window tiles there. Fix: a subtitle that says so.
 */
let mockProduction = false;
vi.mock("../../lib/shared/settings.js", () => ({
  get production() {
    return mockProduction;
  },
  PERMISSIONS_MODE: 0o755,
}));

const { SettingsPage } = await import("../../lib/prefs/settings.js");
const { KeyboardPage } = await import("../../lib/prefs/keyboard.js");

afterEach(() => vi.restoreAllMocks());

function boundKeys(Page) {
  const settings = new Settings();
  const kbdSettings = new Settings();
  const bound = [];
  const spins = new Map();
  const note = (key) => bound.includes(key) || bound.push(key);
  // A DropDownRow listens on changed::<key> instead of calling bind.
  const realConnect = settings.connect.bind(settings);
  vi.spyOn(settings, "connect").mockImplementation((sig, fn) => {
    if (sig.startsWith("changed::")) note(sig.slice(9));
    return realConnect(sig, fn);
  });
  const realBind = settings.bind.bind(settings);
  vi.spyOn(settings, "bind").mockImplementation((key, obj, prop, flags) => {
    note(key);
    if ("_low" in obj) spins.set(key, [obj._low, obj._high]);
    return realBind(key, obj, prop, flags);
  });
  const page = new Page({ settings, kbdSettings });
  return { bound, spins, page };
}

const widgets = (w) => [w, ...w._children.flatMap(widgets)];

describe("prefs-lifecycle:G011: portable keys have preference rows", () => {
  it("auto-unmaximize-for-tiling follows New window placement", () => {
    const { bound } = boundKeys(SettingsPage);
    const i = bound.indexOf("new-window-placement");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(bound[i + 1]).toBe("auto-unmaximize-for-tiling");
  });

  it("close-spec-gaps:N09: the switch says it unmaximizes the other windows", () => {
    const { page } = boundKeys(SettingsPage);
    const row = widgets(page).find((w) => w.title === "Unmaximize windows when tiling");
    expect(row.get_subtitle()).toBe(
      "When a new window tiles, unmaximize the other maximized windows on its monitor"
    );
  });

  it("resize-amount is bound to a 1-100 spin button", () => {
    const { spins } = boundKeys(KeyboardPage);
    expect(spins.get("resize-amount")).toEqual([1, 100]);
  });

  it("a debug build binds logging-enabled before log-level", () => {
    mockProduction = false;
    const { bound } = boundKeys(SettingsPage);
    expect(bound).toContain("logging-enabled");
    expect(bound.indexOf("logging-enabled")).toBe(bound.indexOf("log-level") - 1);
  });

  it("a shipped build binds neither logging key", () => {
    mockProduction = true;
    const { bound } = boundKeys(SettingsPage);
    expect(bound).not.toContain("logging-enabled");
    expect(bound).not.toContain("log-level");
  });
});
