import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug default-layout-new-window (2026-09-14): Preferences → "Default layout for new
 * windows" set to Tabbed still opens every new window as a plain split sibling and
 * re-tiles the others.
 *
 * Root cause: `default-window-layout` was only read by the Split command
 * (applyDefaultLayoutToContainer after tree.split), never by trackWindow, so the
 * setting named "for new windows" never touched a new window.
 *
 * Fix: when a new tiled window attaches next to a focused window that is not already
 * in a TABBED/STACKED container, trackWindow wraps the pair in a container carrying
 * the default layout; a focused window already in such a container just gains a
 * sibling tab. `tiled` keeps the split behaviour.
 */
describe("Bug default-layout-new-window: a new window joins the focused window per default-window-layout", () => {
  let ctx, wm, tree, monitor;

  function fixture(layout) {
    ctx = createWindowManagerFixture({
      settings: {
        "tiling-mode-enabled": true,
        "default-window-layout": layout,
        "tabbed-tiling-mode-enabled": true,
        "stacked-tiling-mode-enabled": true,
      },
    });
    wm = ctx.windowManager;
    tree = ctx.tree;
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
  }

  function open(id) {
    const win = createMockWindow({ wm_class: "App", id, title: id, allows_resize: true });
    wm.trackWindow(null, win);
    wm.processFloats();
    // What the focus handler does: the focused node is where the next window attaches.
    ctx.display.get_focus_window.mockReturnValue(win);
    tree.attachNode = tree.findNode(win);
    return tree.attachNode;
  }

  afterEach(() => ctx.cleanup());

  describe("tabbed", () => {
    beforeEach(() => fixture("tabbed"));

    it("wraps the focused window and the newcomer in one TABBED container", () => {
      const a = open("A");
      const b = open("B");

      expect(monitor.childNodes.length).toBe(1);
      const con = monitor.childNodes[0];
      expect(con.nodeType).toBe(NODE_TYPES.CON);
      expect(con.layout).toBe(LAYOUT_TYPES.TABBED);
      expect(con.getNodeByType(NODE_TYPES.WINDOW).map((n) => n.nodeValue)).toEqual([
        a.nodeValue,
        b.nodeValue,
      ]);
    });

    it("adds a third window as another tab of the same container", () => {
      open("A");
      open("B");
      const c = open("C");

      expect(monitor.childNodes.length).toBe(1);
      const con = monitor.childNodes[0];
      expect(con.layout).toBe(LAYOUT_TYPES.TABBED);
      expect(c.parentNode).toBe(con);
      expect(con.childNodes.length).toBe(3);
    });

    it("still opens the first window of an empty monitor directly under it", () => {
      const a = open("A");
      expect(a.parentNode).toBe(monitor);
    });
  });

  describe("tiled", () => {
    beforeEach(() => fixture("tiled"));

    it("keeps the split behaviour", () => {
      const a = open("A");
      const b = open("B");
      expect(monitor.childNodes).toEqual([a, b]);
    });
  });
});
