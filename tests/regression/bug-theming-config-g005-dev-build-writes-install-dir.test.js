import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * theming-config:G005: _updateCss() wrote through _getStylesheetFile(), which
 * returned the bundled default whenever `production` was false or the user
 * stylesheet getter returned null. A debug build therefore wrote every prefs
 * colour change into the install tree, and a shipped build whose profile
 * stylesheet turned null (the getter re-runs loadFile on each read) chmodded
 * and overwrote the installed stylesheet.css.
 *
 * Fix: _updateCss() writes configMgr.stylesheetFile or returns false; the read
 * path is `stylesheetFile ?? defaultStylesheetFile` in every build, so a debug
 * build reads the same file it writes.
 */
let mockProduction = false;
vi.mock("../../lib/shared/settings.js", () => ({
  get production() {
    return mockProduction;
  },
  PERMISSIONS_MODE: 0o755,
}));

const userCss = `.tiled { color: rgb(1, 2, 3); border-width: 3px; opacity: 0.8; }`;
const defaultCss = `.tiled { color: rgb(9, 9, 9); border-width: 3px; opacity: 0.8; }`;

function makeFile(path, css) {
  const file = new File(path);
  file.load_contents = vi.fn(() => [true, new TextEncoder().encode(css), null]);
  vi.spyOn(file, "replace_contents");
  vi.spyOn(file, "set_attribute_uint32");
  return file;
}

describe("theming-config:G005: the installed stylesheet is never written", () => {
  let userFile;
  let defaultFile;
  let userAvailable;

  function makeTheme() {
    userFile = makeFile("/home/user/.config/forge/stylesheet/forge/stylesheet.css", userCss);
    defaultFile = makeFile("/usr/share/gnome-shell/extensions/forge/stylesheet.css", defaultCss);
    userAvailable = true;
    const configMgr = {
      get stylesheetFile() {
        return userAvailable ? userFile : null;
      },
      defaultStylesheetFile: defaultFile,
    };
    const theme = new ThemeManagerBase({ configMgr, settings: new Settings() });
    theme.reloadStylesheet = vi.fn();
    return theme;
  }

  beforeEach(() => {
    mockProduction = false;
  });

  it("a debug build edits the user stylesheet and leaves the default alone", () => {
    const theme = makeTheme();

    expect(theme.setCssProperty(".tiled", "opacity", "0.5")).toBe(true);

    expect(userFile.replace_contents).toHaveBeenCalledTimes(1);
    const written = new TextDecoder().decode(userFile.replace_contents.mock.calls[0][0]);
    // The user's own colour survives: the AST came from the file being written.
    expect(written).toContain("rgb(1, 2, 3)");
    expect(written).toContain("0.5");
    expect(defaultFile.replace_contents).not.toHaveBeenCalled();
    expect(defaultFile.set_attribute_uint32).not.toHaveBeenCalled();
  });

  it("a shipped build whose user stylesheet turns null refuses to write", () => {
    mockProduction = true;
    const theme = makeTheme();
    userAvailable = false;

    expect(theme.setCssProperty(".tiled", "opacity", "0.5")).toBe(false);

    expect(defaultFile.replace_contents).not.toHaveBeenCalled();
    expect(defaultFile.set_attribute_uint32).not.toHaveBeenCalled();
    expect(theme.reloadStylesheet).not.toHaveBeenCalled();
  });
});
