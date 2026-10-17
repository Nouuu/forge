// close-spec-gaps:T045: when the user windows.json exists but does not parse, the windowProps
// getter falls back to the bundled default (forge-wzbl) and keeps no record of it. The next
// save (a prefs Add, Remove or Reset, or a shell float toggle through the setter) then wrote
// the bundled rules plus the change over the user file with replace_contents: every user rule
// was gone, with no backup.
// Fix: the getter records that the user file exists but is invalid (reset on each read), and
// saveWindowProps refuses to write while it is set. The page toasts, the shell logs.
import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfigManager } from "../../lib/shared/settings.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { File } from "../mocks/gnome/Gio.js";
import {
  installFileStore,
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

const USER = "/home/test/.config/forge/config/windows.json";
const DEFAULT = "/mock/config/windows.json";
const BUNDLED = JSON.stringify({ overrides: [{ wmClass: "Alpha", mode: "float" }] });
const MALFORMED = '{ "overrides": [ { "wmClass": "Mine", "mode": "float" }';
const rules = (...names) => ({ overrides: names.map((wmClass) => ({ wmClass, mode: "float" })) });

afterEach(() => vi.restoreAllMocks());

describe("close-spec-gaps:T045: a windows.json that does not parse is never overwritten", () => {
  it("saveWindowProps refuses after a read of a malformed user file", () => {
    const store = installFileStore({ [USER]: MALFORMED, [DEFAULT]: BUNDLED });
    const mgr = new ConfigManager({ dir: new File("/mock") });

    expect(mgr.windowProps).toEqual(JSON.parse(BUNDLED));
    expect(mgr.saveWindowProps(rules("Gamma"))).toBe(false);
    expect(store.files.get(USER)).toBe(MALFORMED);
  });

  it("a later read of a repaired file clears the refusal", () => {
    const store = installFileStore({ [USER]: MALFORMED, [DEFAULT]: BUNDLED });
    const mgr = new ConfigManager({ dir: new File("/mock") });
    void mgr.windowProps;
    store.files.set(USER, JSON.stringify(rules("Mine")));

    expect(mgr.windowProps).toEqual(rules("Mine"));
    expect(mgr.saveWindowProps(rules("Mine", "Gamma"))).toBe(true);
    expect(JSON.parse(store.files.get(USER))).toEqual(rules("Mine", "Gamma"));
  });

  it("a missing user file is seeded from the bundled default and saves", () => {
    const store = installFileStore({ [DEFAULT]: BUNDLED });
    vi.spyOn(File.prototype, "create").mockImplementation(function () {
      const filePath = this.path;
      return {
        write_all: (bytes) => store.files.set(filePath, new TextDecoder().decode(bytes)),
        close: () => {},
      };
    });
    const mgr = new ConfigManager({ dir: new File("/mock") });

    expect(mgr.windowProps).toEqual(JSON.parse(BUNDLED));
    expect(store.files.get(USER)).toBe(BUNDLED);
    expect(mgr.saveWindowProps(rules("Alpha", "Gamma"))).toBe(true);
    expect(JSON.parse(store.files.get(USER))).toEqual(rules("Alpha", "Gamma"));
  });

  it("a shell float toggle leaves the malformed user file untouched", () => {
    const store = installFileStore({ [USER]: MALFORMED, [DEFAULT]: BUNDLED });
    const ctx = createWindowManagerFixture();
    try {
      ctx.windowManager.ext.configMgr = new ConfigManager({ dir: new File("/mock") });
      const win = createMockWindow({ wm_class: "Term", id: 7, title: "t", allows_resize: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win).mode = WINDOW_MODES.TILE;

      ctx.windowManager.toggleFloatingMode({ name: "FloatToggle", mode: WINDOW_MODES.FLOAT }, win);

      expect(store.files.get(USER)).toBe(MALFORMED);
      // The float still applies for the session.
      expect(ctx.windowManager.windowProps.overrides).toContainEqual(
        expect.objectContaining({ wmClass: "Term", wmId: 7, mode: "float" })
      );
    } finally {
      ctx.cleanup();
    }
  });
});
