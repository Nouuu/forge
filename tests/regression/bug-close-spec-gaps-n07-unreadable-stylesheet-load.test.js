import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import St from "gi://St";
import { File } from "../mocks/gnome/Gio.js";
import { ExtensionThemeManager } from "../../lib/extension/extension-theme-manager.js";
import { Logger } from "../../lib/shared/logger.js";

/**
 * close-spec-gaps:N07: reloadStylesheet unloads the bundled default, then loads
 * the profile stylesheet that ConfigManager.loadFile returns. query_exists is
 * true for a file the user cannot read, so St gets that file, fails to read it
 * and throws. The catch logged and returned: no Forge stylesheet was loaded at
 * all (no focus border, no tab bar styling). Only the in-memory AST fell back
 * to the default (forge-pu64).
 *
 * Fix: in the catch, load the bundled default when the failed file was not the
 * default, and keep it as this.stylesheet so disable() can unload it.
 */
const sampleCss = `.tiled { color: rgba(255,255,255,0.8); border-width: 1px; opacity: 0.8; }`;
const permissionDenied = () => {
  throw new Error("GLib.Error g-io-error-quark: Permission denied");
};

function makeFile(filePath) {
  const file = new File(filePath);
  file.load_contents = vi.fn(() => [true, new TextEncoder().encode(sampleCss), null]);
  return file;
}

describe("close-spec-gaps:N07: an unreadable user stylesheet still leaves Forge styled", () => {
  let theme;
  let userFile;
  let defaultFile;

  beforeEach(() => {
    userFile = makeFile("/home/user/.config/forge/stylesheet/forge/stylesheet.css");
    defaultFile = makeFile("/usr/share/gnome-shell/extensions/forge/stylesheet.css");
    theme = { load_stylesheet: vi.fn(), unload_stylesheet: vi.fn() };
    vi.spyOn(St.ThemeContext, "get_for_stage").mockReturnValue({ get_theme: () => theme });
    vi.spyOn(Logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeManager(stylesheetFile = userFile) {
    return new ExtensionThemeManager({
      metadata: { uuid: "forge@jmmaranan.com" },
      configMgr: { stylesheetFile, defaultStylesheetFile: defaultFile },
      settings: {},
    });
  }

  it("loads the bundled default when St cannot read the user's", () => {
    userFile.load_contents = vi.fn(permissionDenied);
    theme.load_stylesheet = vi.fn((file) => {
      if (file === userFile) permissionDenied();
    });
    const mgr = makeManager();

    mgr.reloadStylesheet();

    expect(theme.load_stylesheet).toHaveBeenLastCalledWith(defaultFile);
    expect(mgr.stylesheet).toBe(defaultFile);
    expect(Logger.error).toHaveBeenCalled();
  });

  it("does not load the default twice when the default itself fails", () => {
    theme.load_stylesheet = vi.fn(permissionDenied);
    const mgr = makeManager(null);

    expect(() => mgr.reloadStylesheet()).not.toThrow();

    expect(theme.load_stylesheet).toHaveBeenCalledTimes(1);
    expect(mgr.stylesheet).toBeUndefined();
  });

  it("a readable user stylesheet still loads (control)", () => {
    const mgr = makeManager();

    mgr.reloadStylesheet();

    expect(theme.load_stylesheet).toHaveBeenCalledTimes(1);
    expect(theme.load_stylesheet).toHaveBeenCalledWith(userFile);
    expect(mgr.stylesheet).toBe(userFile);
  });
});
