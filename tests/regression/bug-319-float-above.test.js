import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug #319: Nautilus toggle float stuck in "always on top"
 *
 * Problem: After toggling float on Nautilus, it gets stuck in "always on top"
 * float mode and cannot be tiled again. Standard shortcuts don't respond.
 *
 * Root Cause: The toggleFloatingMode function directly sets nodeWindow.mode
 * instead of using the nodeWindow.float setter, which handles _forgeSetAbove
 * tracking for always-on-top state.
 *
 * _forgeSetAbove lives on the Meta.Window, not on the tree node: a node is
 * rebuilt by every tree reload while the GNOME pin it describes is not.
 */
describe("Bug #319: Float always-on-top handling", () => {
  let ctx;

  beforeEach(() => {
    // float-always-on-top-enabled is TRUE for this test
    ctx = createWindowManagerFixture({
      settings: { "float-always-on-top-enabled": true },
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("pin ownership survives a tree reload", () => {
    // The reload hole in the same bug class: tree.reload() sets
    // `childNodes.length = 0` and trackCurrentWindows rebuilds every WINDOW node
    // from scratch, so ownership state parked on the NODE is gone while the
    // GNOME pin — which lives on the Meta.Window — survives. Forge then either
    // strands the pin forever (unfloat no longer recognises it as its own) or,
    // worse, later strips a pin the USER applied.
    const buildFloat = () => {
      const mw = createMockWindow({
        wm_class: "org.gnome.Nautilus",
        id: 3001,
        title: "Files",
        allows_resize: true,
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, mw);
      node.mode = WINDOW_MODES.TILE;
      node.float = true;
      return { mw, monitor };
    };

    // What reloadTree() does: tree.reload() then trackCurrentWindows(). Rebuilt
    // here directly so the test does not depend on the idle_add scheduling.
    const rebuildNode = (mw) => {
      ctx.tree.reload();
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, mw);
      node.mode = WINDOW_MODES.FLOAT;
      return node;
    };

    it("still recognises its own pin after the node is rebuilt", () => {
      const { mw } = buildFloat();
      expect(mw.is_above()).toBe(true);

      const rebuilt = rebuildNode(mw);

      rebuilt.float = false;

      expect(mw.is_above()).toBe(false);
      expect(rebuilt.isTile()).toBe(true);
    });

    it("still refuses to strip a user pin after the node is rebuilt", () => {
      const mw = createMockWindow({
        wm_class: "org.gnome.Nautilus",
        id: 3002,
        title: "Files",
        allows_resize: true,
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, mw);
      node.mode = WINDOW_MODES.FLOAT;
      mw.make_above(); // the USER pins it; Forge never claimed this one

      const rebuilt = rebuildNode(mw);
      rebuilt.float = false;

      expect(mw.is_above()).toBe(true);
    });
  });

  describe("_forgeSetAbove tracking", () => {
    it("should track _forgeSetAbove when floating window with float-always-on-top enabled", () => {
      const nautilus = createMockWindow({
        wm_class: "org.gnome.Nautilus",
        id: 1001,
        title: "Files",
        allows_resize: true,
      });

      // Add window to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, nautilus);
      nodeWindow.mode = WINDOW_MODES.TILE;

      // Initially, _forgeSetAbove should be undefined or false
      expect(nautilus._forgeSetAbove).toBeFalsy();

      // Float the window using the float setter (which toggleFloatingMode should use)
      nodeWindow.float = true;

      // _forgeSetAbove should be set because float-always-on-top is enabled
      expect(nautilus._forgeSetAbove).toBe(true);
      expect(nautilus.is_above()).toBe(true);
    });

    it("should clear always-on-top when unfloating if Forge set it", () => {
      const nautilus = createMockWindow({
        wm_class: "org.gnome.Nautilus",
        id: 1001,
        title: "Files",
        allows_resize: true,
      });

      // Add window to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, nautilus);

      // Float the window (sets _forgeSetAbove)
      nodeWindow.float = true;

      expect(nautilus._forgeSetAbove).toBe(true);
      expect(nautilus.is_above()).toBe(true);

      // Unfloat the window
      nodeWindow.float = false;

      // Bug #319: Window should no longer be above
      expect(nautilus.is_above()).toBe(false);
      expect(nautilus._forgeSetAbove).toBe(false);
    });

    it("should not clear always-on-top if user set it manually", () => {
      const nautilus = createMockWindow({
        wm_class: "org.gnome.Nautilus",
        id: 1001,
        title: "Files",
        allows_resize: true,
      });

      // Add window to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, nautilus);

      // Simulate user setting always-on-top manually BEFORE floating
      nautilus.make_above();
      expect(nautilus.is_above()).toBe(true);

      // Float the window - _forgeSetAbove should NOT be set because window was already above
      nodeWindow.float = true;

      expect(nautilus._forgeSetAbove).toBeFalsy();
      expect(nautilus.is_above()).toBe(true);

      // Unfloat the window
      nodeWindow.float = false;

      // Should remain above because user set it, not Forge
      expect(nautilus.is_above()).toBe(true);
    });
  });

  describe("toggleFloatingMode with always-on-top", () => {
    it("should properly handle always-on-top when toggling float on", () => {
      const nautilus = createMockWindow({
        wm_class: "org.gnome.Nautilus",
        id: 1001,
        title: "Files",
        allows_resize: true,
      });

      // Add window to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, nautilus);
      nodeWindow.mode = WINDOW_MODES.TILE;

      // Toggle float on
      const action = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      ctx.windowManager.toggleFloatingMode(action, nautilus);

      // Window should be floating and above
      expect(nodeWindow.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nautilus.is_above()).toBe(true);
      expect(nautilus._forgeSetAbove).toBe(true);
    });

    it("should properly handle always-on-top when toggling float off", () => {
      const nautilus = createMockWindow({
        wm_class: "org.gnome.Nautilus",
        id: 1001,
        title: "Files",
        allows_resize: true,
      });

      // Add window to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, nautilus);

      // Float the window first
      const floatAction = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      ctx.windowManager.toggleFloatingMode(floatAction, nautilus);

      expect(nodeWindow.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nautilus.is_above()).toBe(true);
      expect(nautilus._forgeSetAbove).toBe(true);

      // Toggle float off
      const unfloatAction = { name: "FloatToggle", mode: WINDOW_MODES.TILE };
      ctx.windowManager.toggleFloatingMode(unfloatAction, nautilus);

      // Bug #319: Window should be tiled and NOT above
      expect(nodeWindow.mode).toBe(WINDOW_MODES.TILE);
      expect(nautilus.is_above()).toBe(false);
      expect(nautilus._forgeSetAbove).toBe(false);
    });

    it("should not get stuck in always-on-top after multiple toggles", () => {
      const nautilus = createMockWindow({
        wm_class: "org.gnome.Nautilus",
        id: 1001,
        title: "Files",
        allows_resize: true,
      });

      // Add window to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, nautilus);
      nodeWindow.mode = WINDOW_MODES.TILE;

      const floatAction = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      const unfloatAction = { name: "FloatToggle", mode: WINDOW_MODES.TILE };

      // Toggle multiple times
      ctx.windowManager.toggleFloatingMode(floatAction, nautilus);
      expect(nautilus.is_above()).toBe(true);

      ctx.windowManager.toggleFloatingMode(unfloatAction, nautilus);
      expect(nautilus.is_above()).toBe(false);

      ctx.windowManager.toggleFloatingMode(floatAction, nautilus);
      expect(nautilus.is_above()).toBe(true);

      ctx.windowManager.toggleFloatingMode(unfloatAction, nautilus);
      // Bug #319: Should NOT be stuck in always-on-top
      expect(nautilus.is_above()).toBe(false);
      expect(nautilus._forgeSetAbove).toBe(false);
    });
  });
});
