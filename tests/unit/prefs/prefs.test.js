// prefs-lifecycle:G001: the preferences entry point, measured since commit 78a732b.
import { describe, it, expect, vi } from "vitest";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";
import ForgeExtensionPreferences from "../../../prefs.js";
import { SettingsPage } from "../../../lib/prefs/settings.js";
import { AppearancePage } from "../../../lib/prefs/appearance.js";
import { KeyboardPage } from "../../../lib/prefs/keyboard.js";
import { FloatingPage } from "../../../lib/prefs/floating.js";
import { PortabilityPage } from "../../../lib/prefs/portability.js";

function makeWindow(withHeaderBar) {
  const win = new Gtk.Box({});
  const bar = new Adw.HeaderBar({});
  if (withHeaderBar) win.append(bar);
  const pages = [];
  win.add = vi.fn((page) => pages.push(page));
  return { win, bar, pages };
}

describe("ForgeExtensionPreferences.fillPreferencesWindow", () => {
  it("adds Tiling, Appearance, Keyboard, Windows, Portability in order", () => {
    const { win, pages } = makeWindow(true);
    new ForgeExtensionPreferences().fillPreferencesWindow(win);
    expect(pages.map((p) => p.constructor)).toEqual([
      SettingsPage,
      AppearancePage,
      KeyboardPage,
      FloatingPage,
      PortabilityPage,
    ]);
    expect(win.search_enabled).toBe(true);
    expect(win.can_navigate_back).toBe(true);
  });

  it("packs About into the header bar when one is found", () => {
    const { win, bar } = makeWindow(true);
    bar.pack_end = vi.fn();
    const prefs = new ForgeExtensionPreferences();
    prefs.fillPreferencesWindow(win);
    expect(bar.pack_end).toHaveBeenCalledTimes(1);
    expect(prefs.aboutButton).toBeNull();
  });

  it("keeps About for the Tiling page when no header bar is found", () => {
    const { win } = makeWindow(false);
    const prefs = new ForgeExtensionPreferences();
    prefs.fillPreferencesWindow(win);
    expect(prefs.aboutButton).toBeInstanceOf(Gtk.Button);
  });
});
