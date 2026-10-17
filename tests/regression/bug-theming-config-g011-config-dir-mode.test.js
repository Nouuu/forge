// theming-config:G011: PERMISSIONS_MODE was 0o744, so the config directories that
// _saveJsonConfig and ThemeManagerBase._updateCss create through GLib.mkdir_with_parents had
// no group or other execute bit, unlike the Gio sites (0777 minus umask, typically 0755).
// Fix: PERMISSIONS_MODE = 0o755 (directories only). Existing directories keep their mode.
import { describe, it, expect, vi, afterEach } from "vitest";
import GLib from "gi://GLib";
import { ConfigManager } from "../../lib/shared/settings.js";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

afterEach(() => vi.restoreAllMocks());

function fileIn(dir, name) {
  const f = new File(`${dir}/${name}`);
  f.get_parent = () => ({ get_path: () => dir });
  f.replace_contents = vi.fn(() => [true, null]);
  f.load_contents = vi.fn(() => [true, new TextEncoder().encode(".tiled { opacity: 0.8; }"), null]);
  return f;
}

describe("config directories are created 0755", () => {
  it("_saveJsonConfig passes 0o755 to mkdir_with_parents", () => {
    const mkdir = vi.spyOn(GLib, "mkdir_with_parents").mockReturnValue(0);
    const cm = new ConfigManager({ dir: { get_path: () => "/test/extension" } });
    expect(cm._saveJsonConfig(fileIn("/mock/cfg", "a.json"), { a: 1 }, "a.json")).toBe(true);
    expect(mkdir).toHaveBeenCalledWith("/mock/cfg", 0o755);
  });

  it("_updateCss passes 0o755 to mkdir_with_parents", () => {
    const mkdir = vi.spyOn(GLib, "mkdir_with_parents").mockReturnValue(0);
    const file = fileIn("/mock/css", "stylesheet.css");
    const tm = new ThemeManagerBase({
      configMgr: {
        stylesheetFile: file,
        defaultStylesheetFile: file,
        stylesheetFileName: "/mock/css/stylesheet.css",
      },
      settings: new Settings(),
    });
    tm.reloadStylesheet = vi.fn();
    mkdir.mockClear();
    tm._updateCss();
    expect(mkdir).toHaveBeenCalledWith("/mock/css", 0o755);
  });
});
