import { describe, it, expect } from "vitest";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * theming-config:G014: patchCss() copied the user stylesheet over one fixed
 * `stylesheet.css.bak` with OVERWRITE before installing the new default. The
 * first cssTag bump saved the user's CSS there; the second bump overwrote it
 * with the previous default, so the user's custom stylesheet was gone for good.
 *
 * Fix: the backup is named after the tag it replaces,
 * `stylesheet.css.<css-last-update>.bak`, so each bump writes its own file and
 * never touches an older one. A legacy `stylesheet.css.bak` is left as is.
 */
const userPath = "/home/user/.config/forge/stylesheet/forge/stylesheet.css";
const defaultPath = "/usr/share/gnome-shell/extensions/forge/stylesheet.css";
const CUSTOM = ".tiled { color: rgb(1, 2, 3); } /* CUSTOM */";

// The Gio.File mock stores no contents (tests/README.md), so this stub keeps
// them in a Map and makes copy() copy them.
function makeDisk() {
  const disk = new Map();
  class DiskFile extends File {
    load_contents() {
      return [true, new TextEncoder().encode(disk.get(this.path) ?? ""), null];
    }
    copy(destination) {
      disk.set(destination.get_path(), disk.get(this.path));
      return true;
    }
  }
  return { disk, DiskFile };
}

describe("theming-config:G014: the user's stylesheet survives two cssTag bumps", () => {
  it("keeps the custom CSS in a backup after the second bump", () => {
    const { disk, DiskFile } = makeDisk();
    disk.set(userPath, CUSTOM);
    disk.set(defaultPath, ".tiled { color: rgb(4, 4, 4); }");
    disk.set(`${userPath}.bak`, "LEGACY");

    const settings = new Settings();
    const theme = new ThemeManagerBase({
      configMgr: {
        stylesheetFile: new DiskFile(userPath),
        defaultStylesheetFile: new DiskFile(defaultPath),
      },
      settings,
    });
    const shipped = theme.cssTag;
    settings.set_uint("css-last-update", shipped - 2);

    theme.cssTag = shipped - 1;
    expect(theme.patchCss()).toBe(true);

    disk.set(defaultPath, ".tiled { color: rgb(5, 5, 5); }");
    theme.cssTag = shipped;
    expect(theme.patchCss()).toBe(true);

    expect(disk.get(userPath)).toBe(".tiled { color: rgb(5, 5, 5); }");
    const holdersOfCustom = [...disk].filter(([p, css]) => p !== userPath && css === CUSTOM);
    expect(holdersOfCustom).toEqual([[`${userPath}.${shipped - 2}.bak`, CUSTOM]]);
    expect(disk.get(`${userPath}.${shipped - 1}.bak`)).toBe(".tiled { color: rgb(4, 4, 4); }");
    expect(disk.get(`${userPath}.bak`)).toBe("LEGACY");
  });
});
