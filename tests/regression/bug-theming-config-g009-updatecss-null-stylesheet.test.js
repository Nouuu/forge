import { describe, it, expect, vi } from "vitest";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * theming-config:G009: _updateCss() took its target from _getStylesheetFile()
 * and called cssFile.get_parent() with no null check. Both ConfigManager
 * getters re-run their lookup on every read, so after a valid AST was imported
 * they can both return null (profile stylesheet gone and unseedable, install
 * copy missing). The next colour change then threw a TypeError out of
 * setCssProperty into the prefs handler.
 *
 * Fix: _updateCss() reads configMgr.stylesheetFile and returns false when it
 * is null.
 */
const sampleCss = `.tiled { color: rgba(255,255,255,0.8); border-width: 3px; opacity: 0.8; }`;

describe("theming-config:G009: _updateCss with no stylesheet file", () => {
  it("returns false without throwing when both getters turn null", () => {
    const file = new File("/mock/stylesheet.css");
    file.load_contents = vi.fn(() => [true, new TextEncoder().encode(sampleCss), null]);
    let available = true;
    const configMgr = {
      get stylesheetFile() {
        return available ? file : null;
      },
      get defaultStylesheetFile() {
        return available ? file : null;
      },
    };
    const theme = new ThemeManagerBase({ configMgr, settings: new Settings() });
    theme.reloadStylesheet = vi.fn();
    expect(theme.cssAst.stylesheet.parsingErrors).toEqual([]);

    available = false;

    let result;
    expect(() => {
      result = theme._updateCss();
    }).not.toThrow();
    expect(result).toBe(false);
    expect(theme.reloadStylesheet).not.toHaveBeenCalled();
  });
});
