import { describe, it, expect, vi } from "vitest";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * close-spec-gaps:N04: when the user stylesheet exists but load_contents throws
 * (no read permission, EIO), _importCss falls back to the default AST
 * (forge-pu64). The next setCssProperty then made _updateCss chmod the user
 * file to 0644 and replace it with the default plus the change. The user's CSS
 * was gone, with no backup.
 *
 * Fix: _importCss remembers that the user stylesheet could not be read (reset
 * on each import), and _updateCss refuses to write while it is set, before
 * _ensureWritable.
 */
const userCss = `.tiled { color: rgb(1, 2, 3); border-width: 3px; opacity: 0.8; }`;
const defaultCss = `.tiled { color: rgb(9, 9, 9); border-width: 3px; opacity: 0.8; }`;

function makeFile(filePath, css) {
  const file = new File(filePath);
  file.load_contents = vi.fn(() => [true, new TextEncoder().encode(css), null]);
  vi.spyOn(file, "replace_contents");
  vi.spyOn(file, "set_attribute_uint32");
  return file;
}

function makeTheme({ userReadable = true, userPresent = true } = {}) {
  const userFile = makeFile("/home/user/.config/forge/stylesheet/forge/stylesheet.css", userCss);
  if (!userReadable) {
    userFile.load_contents = vi.fn(() => {
      throw new Error("GLib.Error g-io-error-quark: Permission denied");
    });
  }
  const defaultFile = makeFile(
    "/usr/share/gnome-shell/extensions/forge/stylesheet.css",
    defaultCss
  );
  const configMgr = {
    stylesheetFile: userPresent ? userFile : null,
    defaultStylesheetFile: defaultFile,
  };
  const theme = new ThemeManagerBase({ configMgr, settings: new Settings() });
  theme.reloadStylesheet = vi.fn();
  return { theme, userFile, defaultFile, configMgr };
}

describe("close-spec-gaps:N04: an unreadable user stylesheet is never overwritten", () => {
  it("refuses the change and leaves the unreadable file untouched", () => {
    const { theme, userFile } = makeTheme({ userReadable: false });

    expect(theme.setCssProperty(".tiled", "opacity", "0.5")).toBe(false);

    expect(userFile.replace_contents).not.toHaveBeenCalled();
    expect(userFile.set_attribute_uint32).not.toHaveBeenCalled();
    expect(theme.reloadStylesheet).not.toHaveBeenCalled();
  });

  it("a later readable import clears the refusal", () => {
    const { theme, userFile } = makeTheme({ userReadable: false });
    userFile.load_contents = vi.fn(() => [true, new TextEncoder().encode(userCss), null]);
    theme._importCss();

    expect(theme.setCssProperty(".tiled", "opacity", "0.5")).toBe(true);
    expect(userFile.replace_contents).toHaveBeenCalledTimes(1);
  });

  it("a readable user stylesheet still saves", () => {
    const { theme, userFile } = makeTheme();

    expect(theme.setCssProperty(".tiled", "opacity", "0.5")).toBe(true);

    expect(userFile.replace_contents).toHaveBeenCalledTimes(1);
    const written = new TextDecoder().decode(userFile.replace_contents.mock.calls[0][0]);
    expect(written).toContain("rgb(1, 2, 3)");
    expect(written).toContain("0.5");
  });

  it("a missing user stylesheet keeps today's behaviour", () => {
    const { theme, userFile, defaultFile, configMgr } = makeTheme({ userPresent: false });
    expect(defaultFile.load_contents).toHaveBeenCalled();

    // No user file to write: refused, the default is never touched.
    expect(theme.setCssProperty(".tiled", "opacity", "0.5")).toBe(false);
    expect(defaultFile.replace_contents).not.toHaveBeenCalled();
    expect(defaultFile.set_attribute_uint32).not.toHaveBeenCalled();

    // Seeded later: the change is written to the new user file.
    configMgr.stylesheetFile = userFile;
    expect(theme.setCssProperty(".tiled", "opacity", "0.5")).toBe(true);
    expect(userFile.replace_contents).toHaveBeenCalledTimes(1);
  });

  it("an unreadable default alone does not block a later write", () => {
    const { theme, userFile, defaultFile, configMgr } = makeTheme({ userPresent: false });
    defaultFile.load_contents = vi.fn(() => {
      throw new Error("GLib.Error g-io-error-quark: Input/output error");
    });
    theme._importCss();

    configMgr.stylesheetFile = userFile;
    expect(theme.setCssProperty(".tiled", "opacity", "0.5")).toBe(true);
    expect(userFile.replace_contents).toHaveBeenCalledTimes(1);
  });
});
