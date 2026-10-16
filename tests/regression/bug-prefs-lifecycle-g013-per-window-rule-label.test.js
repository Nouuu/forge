// prefs-lifecycle:G013: a per-window rule (wmId, written by the snap commands, dropped when the
// window closes) was listed like a persistent class rule: the class showed twice.
// Fix: floatRowSubtitle(override, titleOnlyLabel, perWindowLabel) returns perWindowLabel for a
// wmId rule, and the Windows page passes "This window only, until it closes".
import { describe, it, expect, vi, afterEach } from "vitest";
import { floatRowSubtitle } from "../../lib/prefs/floating-overrides.js";
import { FloatingPage } from "../../lib/prefs/floating.js";
import { File, Settings } from "../mocks/gnome/Gio.js";
import { installFileStore } from "../mocks/helpers/index.js";

const USER = "/home/test/.config/forge/config/windows.json";

afterEach(() => vi.restoreAllMocks());

describe("floatRowSubtitle", () => {
  it("returns the per-window label for a wmId rule and the class otherwise", () => {
    expect(floatRowSubtitle({ wmClass: "App", wmId: 7, mode: "float" }, "T", "P")).toBe("P");
    expect(floatRowSubtitle({ wmClass: "App", mode: "float" }, "T", "P")).toBe("App");
    expect(floatRowSubtitle({ wmTitle: "x", mode: "float" }, "T", "P")).toBe("T");
  });
});

describe("Windows page", () => {
  it("lists a wmId rule with the per-window subtitle", () => {
    installFileStore({
      [USER]: JSON.stringify({
        overrides: [
          { wmClass: "App", wmId: 7, mode: "float" },
          { wmClass: "Beta", mode: "float" },
        ],
      }),
      "/mock/config/windows.json": JSON.stringify({ overrides: [] }),
    });
    const page = new FloatingPage({ settings: new Settings(), dir: new File("/mock") });

    const subtitles = page.rows.map((r) => r.get_subtitle());

    expect(subtitles).toEqual(["This window only, until it closes", "Beta"]);
  });
});
