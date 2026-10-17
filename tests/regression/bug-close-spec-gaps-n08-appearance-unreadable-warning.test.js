import { describe, it, expect, vi, afterEach } from "vitest";
import { AppearancePage } from "../../lib/prefs/appearance.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * close-spec-gaps:N08: since close-spec-gaps:N04, _updateCss refuses to write a
 * user stylesheet that could not be read. The Appearance page ignored the false
 * return of setCssProperty, so its controls showed the bundled defaults and no
 * change was saved, with no message (Logger output is compiled out in a shipped
 * build).
 *
 * Fix: the page adds a warning group, like the forge-y3jy one, when the theme
 * manager could not read the user stylesheet.
 */
const css = `.window-tiled-border { border-width: 3px; border-color: rgba(255, 0, 0, 1); }`;
const userPath = "/home/test/.config/forge/stylesheet/forge/stylesheet.css";

afterEach(() => vi.restoreAllMocks());

function buildPage({ userReadable }) {
  vi.spyOn(File.prototype, "load_contents").mockImplementation(function () {
    if (!userReadable && this.path === userPath) {
      throw new Error("GLib.Error g-io-error-quark: Permission denied");
    }
    return [true, new TextEncoder().encode(css), null];
  });
  const settings = new Settings();
  settings.set_uint("css-last-update", 0);
  return new AppearancePage({ settings, dir: new File("/mock") });
}

const unreadableWarning = (page) =>
  page._children.find((group) => group.description?.includes("stylesheet.css cannot be read"));

describe("close-spec-gaps:N08: the Appearance page says when it cannot save", () => {
  it("shows the warning when the user stylesheet cannot be read", () => {
    const page = buildPage({ userReadable: false });

    expect(page.themeMgr.setCssProperty(".window-tiled-border", "border-width", "5px")).toBe(false);
    expect(unreadableWarning(page)).toBeDefined();
  });

  it("shows no warning when the user stylesheet is readable", () => {
    const page = buildPage({ userReadable: true });

    expect(unreadableWarning(page)).toBeUndefined();
  });
});
