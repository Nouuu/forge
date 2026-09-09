import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug #482 (forge-3qq): apps with a late/null wm_class never auto-tile.
 *
 * Anki, Opera, and many Flatpak apps report a null wm_class at map time. The
 * `get_wm_class() === null` clause in isFloatingExempt floats them, and because
 * no signal re-evaluates the decision once the class lands, they stay floated
 * forever (also explains the stuck-floating reports in #387/#453/#219).
 *
 * Fix: a notify::wm-class handler in trackWindow re-renders, so processFloats
 * re-evaluates and tiles the window once its class is known.
 */
describe("Bug #482: late wm_class re-tiles", () => {
  let ctx;
  let win;
  let node;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    // A real Anki window: NORMAL, resizable, with a title — but no wm_class yet.
    win = createMockWindow({
      wm_class: null,
      id: 2001,
      title: "Anki",
      allows_resize: true,
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("floats a window while its wm_class is null", () => {
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(true);
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);
  });

  it("re-tiles the window once wm_class arrives", () => {
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);

    // The class lands late. Once known, the window is no longer floating-exempt.
    win.set_wm_class("Anki");
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(false);

    ctx.windowManager.processFloats();
    expect(node.isTile()).toBe(true);
  });

  it("wires notify::wm-class in trackWindow so a late class re-renders", () => {
    // End-to-end: trackWindow must connect the signal itself. Before the fix
    // there is no notify::wm-class handler, so the late class is never noticed.
    const tracked = createMockWindow({
      wm_class: null,
      id: 2002,
      title: "Opera",
      allows_resize: true,
    });
    ctx.windowManager.trackWindow(null, tracked);

    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree");
    tracked.set_wm_class("Opera");

    expect(renderSpy).toHaveBeenCalledWith("wm-class-changed");
  });

  // The #482 fix only works while nothing else keeps the window floating-exempt.
  // With float-always-on-top-enabled on, the `float` setter pins the window while
  // its class is null, and isFloatingExempt's Bug #469 clause then reads that pin
  // — Forge's own — as a user "Always on Top" overlay. processFloats re-derives
  // float=true from the pin it set itself, so the late class never re-tiles.
  describe("with float-always-on-top-enabled", () => {
    let pinCtx;
    let pinWin;
    let pinNode;

    beforeEach(() => {
      pinCtx = createWindowManagerFixture({
        settings: { "float-always-on-top-enabled": true },
      });
      pinWin = createMockWindow({
        wm_class: null,
        id: 2003,
        title: "Anki",
        allows_resize: true,
      });
      const { monitor } = getWorkspaceAndMonitor(pinCtx);
      pinNode = pinCtx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, pinWin);
      pinNode.mode = WINDOW_MODES.TILE;
    });

    afterEach(() => pinCtx.cleanup());

    it("pins the window while its wm_class is null", () => {
      pinCtx.windowManager.processFloats();

      expect(pinNode.isFloat()).toBe(true);
      expect(pinWin.is_above()).toBe(true);
    });

    it("re-tiles and unpins once wm_class arrives", () => {
      pinCtx.windowManager.processFloats();
      expect(pinWin.is_above()).toBe(true);

      pinWin.set_wm_class("Anki");

      // Forge's own pin must not read back as a user overlay.
      expect(pinCtx.windowManager.isFloatingExempt(pinWin)).toBe(false);

      pinCtx.windowManager.processFloats();
      expect(pinNode.isTile()).toBe(true);
      expect(pinWin.is_above()).toBe(false);
    });

    it("still treats a pin the user applied as an overlay", () => {
      const userPinned = createMockWindow({
        wm_class: "Anki",
        id: 2004,
        title: "Anki",
        allows_resize: true,
      });
      const { monitor } = getWorkspaceAndMonitor(pinCtx);
      pinCtx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, userPinned);
      userPinned.make_above();

      expect(pinCtx.windowManager.isFloatingExempt(userPinned)).toBe(true);
    });
  });
});
