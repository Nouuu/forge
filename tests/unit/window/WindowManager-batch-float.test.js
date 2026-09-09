import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";

/**
 * WindowManager batch float/unfloat operations tests
 *
 * Tests for batch operations including:
 * - floatAllWindows(): Float all windows in the tree
 * - unfloatAllWindows(): Unfloat all windows (restore previous state)
 * - floatWorkspace(wsIndex): Float all windows on a specific workspace
 * - unfloatWorkspace(wsIndex): Unfloat all windows on a specific workspace
 * - cleanupAlwaysFloat(): Remove always-on-top from floating windows
 * - restoreAlwaysFloat(): Restore always-on-top for floating windows
 */
describe("WindowManager - Batch Float Operations", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 2 } },
      settings: { "float-always-on-top-enabled": true },
    });
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];
  const workspace1 = () => ctx.workspaces[1];

  describe("floatAllWindows()", () => {
    it("should float all windows in the tree", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const metaWindow2 = createMockWindow({ id: 2 });
      const metaWindow3 = createMockWindow({ id: 3 });

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      const nodeWindow3 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow3);

      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow3.mode = WINDOW_MODES.TILE;

      wm().floatAllWindows();

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow3.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should mark already-floating windows with prevFloat", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const metaWindow2 = createMockWindow({ id: 2 });

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.FLOAT; // Already floating
      nodeWindow2.mode = WINDOW_MODES.TILE;

      wm().floatAllWindows();

      expect(nodeWindow1.prevFloat).toBe(true);
      expect(nodeWindow2.prevFloat).toBeUndefined();
    });

    it("should float windows across multiple workspaces", () => {
      const { monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      const metaWindow2 = createMockWindow({ id: 2, workspace: workspace1() });

      const nodeWindow1 = ctx.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor1.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow2.mode = WINDOW_MODES.TILE;

      wm().floatAllWindows();

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.FLOAT);
    });
  });

  describe("unfloatAllWindows()", () => {
    it("should unfloat all windows that were not previously floating", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const metaWindow2 = createMockWindow({ id: 2 });

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow2.mode = WINDOW_MODES.TILE;

      // Float all
      wm().floatAllWindows();

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.FLOAT);

      // Unfloat all
      wm().unfloatAllWindows();

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.TILE);
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should keep previously-floating windows as floating", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const metaWindow2 = createMockWindow({ id: 2 });

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.FLOAT; // Already floating
      nodeWindow2.mode = WINDOW_MODES.TILE;

      // Float all (marks nodeWindow1 with prevFloat)
      wm().floatAllWindows();

      expect(nodeWindow1.prevFloat).toBe(true);
      expect(nodeWindow2.prevFloat).toBeUndefined();

      // Unfloat all
      wm().unfloatAllWindows();

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT); // Still floating
      expect(nodeWindow1.prevFloat).toBe(false); // Marker reset
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should unfloat windows across multiple workspaces", () => {
      const { monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      const metaWindow2 = createMockWindow({ id: 2, workspace: workspace1() });

      const nodeWindow1 = ctx.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor1.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow2.mode = WINDOW_MODES.TILE;

      wm().floatAllWindows();
      wm().unfloatAllWindows();

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.TILE);
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.TILE);
    });
  });

  describe("floatWorkspace()", () => {
    it("should float all windows on specified workspace", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      const metaWindow2 = createMockWindow({ id: 2, workspace: workspace0() });

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow2.mode = WINDOW_MODES.TILE;

      // Mock getWindowsOnWorkspace to return our test windows
      vi.spyOn(wm(), "getWindowsOnWorkspace").mockReturnValue([nodeWindow1, nodeWindow2]);

      wm().floatWorkspace(0);

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should not affect windows on other workspaces", () => {
      const { monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      const metaWindow2 = createMockWindow({ id: 2, workspace: workspace1() });

      const nodeWindow1 = ctx.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor1.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow2.mode = WINDOW_MODES.TILE;

      // Mock getWindowsOnWorkspace
      vi.spyOn(wm(), "getWindowsOnWorkspace").mockImplementation((wsIndex) => {
        if (wsIndex === 0) return [nodeWindow1];
        if (wsIndex === 1) return [nodeWindow2];
        return [];
      });

      wm().floatWorkspace(0);

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.TILE); // Unchanged
    });

    it("should enable always-on-top for floated windows when setting enabled", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;

      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "float-always-on-top-enabled") return true;
        return false;
      });

      const makeAboveSpy = vi.spyOn(metaWindow1, "make_above");

      vi.spyOn(wm(), "getWindowsOnWorkspace").mockReturnValue([nodeWindow1]);

      wm().floatWorkspace(0);

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(makeAboveSpy).toHaveBeenCalled();
    });
  });

  describe("unfloatWorkspace()", () => {
    it("should unfloat all windows on specified workspace", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      const metaWindow2 = createMockWindow({ id: 2, workspace: workspace0() });

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      nodeWindow2.mode = WINDOW_MODES.FLOAT;

      vi.spyOn(wm(), "getWindowsOnWorkspace").mockReturnValue([nodeWindow1, nodeWindow2]);

      wm().unfloatWorkspace(0);

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.TILE);
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should not affect windows on other workspaces", () => {
      const { monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      const metaWindow2 = createMockWindow({ id: 2, workspace: workspace1() });

      const nodeWindow1 = ctx.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor1.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      nodeWindow2.mode = WINDOW_MODES.FLOAT;

      vi.spyOn(wm(), "getWindowsOnWorkspace").mockImplementation((wsIndex) => {
        if (wsIndex === 0) return [nodeWindow1];
        if (wsIndex === 1) return [nodeWindow2];
        return [];
      });

      wm().unfloatWorkspace(0);

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.TILE);
      expect(nodeWindow2.mode).toBe(WINDOW_MODES.FLOAT); // Unchanged
    });

    it("should change mode to TILE when unfloating", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.FLOAT;

      vi.spyOn(wm(), "getWindowsOnWorkspace").mockReturnValue([nodeWindow1]);

      wm().unfloatWorkspace(0);

      expect(nodeWindow1.mode).toBe(WINDOW_MODES.TILE);
    });
  });

  describe("cleanupAlwaysFloat()", () => {
    it("should remove always-on-top from floating windows", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const metaWindow2 = createMockWindow({ id: 2 });

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      nodeWindow2.mode = WINDOW_MODES.TILE;

      metaWindow1.above = true;

      const unmakeAbove1 = vi.spyOn(metaWindow1, "unmake_above");
      const unmakeAbove2 = vi.spyOn(metaWindow2, "unmake_above");

      wm().cleanupAlwaysFloat();

      expect(unmakeAbove1).toHaveBeenCalled();
      expect(unmakeAbove2).not.toHaveBeenCalled();
    });

    it("should not unmake_above if window is not above", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      metaWindow1.above = false;

      const unmakeAboveSpy = vi.spyOn(metaWindow1, "unmake_above");

      wm().cleanupAlwaysFloat();

      expect(unmakeAboveSpy).not.toHaveBeenCalled();
    });

    it("should process all floating windows across workspaces", () => {
      const { monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      const metaWindow1 = createMockWindow({ id: 1 });
      const metaWindow2 = createMockWindow({ id: 2 });

      const nodeWindow1 = ctx.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor1.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      nodeWindow2.mode = WINDOW_MODES.FLOAT;

      metaWindow1.above = true;
      metaWindow2.above = true;

      const unmakeAbove1 = vi.spyOn(metaWindow1, "unmake_above");
      const unmakeAbove2 = vi.spyOn(metaWindow2, "unmake_above");

      wm().cleanupAlwaysFloat();

      expect(unmakeAbove1).toHaveBeenCalled();
      expect(unmakeAbove2).toHaveBeenCalled();
    });

    // G1/G12: the pin is gone after cleanup, so the ownership flags must go with
    // it. A stale `_forgeSetAbove` makes _restoreAllDemotedFloats re-pin the window
    // the user just unpinned, and makes a later unfloat strip a pin the USER owns.
    it("should clear the Forge pin-ownership flags it invalidates", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      metaWindow1.above = true;
      metaWindow1._forgeSetAbove = true;
      metaWindow1._aboveDemotedForFullscreen = true;

      wm().cleanupAlwaysFloat();

      expect(metaWindow1._forgeSetAbove).toBe(false);
      expect(metaWindow1._aboveDemotedForFullscreen).toBe(false);
    });

    // G1: turning the setting off runs cleanup, then the reconcile pass takes the
    // setting-off early return into _restoreAllDemotedFloats. That must not undo
    // the cleanup that just ran.
    it("should leave nothing for _restoreAllDemotedFloats to re-pin", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      metaWindow1.above = true;
      metaWindow1._forgeSetAbove = true;
      metaWindow1._aboveDemotedForFullscreen = true;

      wm().cleanupAlwaysFloat();
      const makeAboveSpy = vi.spyOn(metaWindow1, "make_above");
      wm()._restoreAllDemotedFloats();

      expect(makeAboveSpy).not.toHaveBeenCalled();
      expect(metaWindow1.is_above()).toBe(false);
    });
  });

  describe("restoreAlwaysFloat()", () => {
    it("should restore always-on-top for floating windows", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const metaWindow2 = createMockWindow({ id: 2 });

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      nodeWindow2.mode = WINDOW_MODES.TILE;

      metaWindow1.above = false;

      const makeAbove1 = vi.spyOn(metaWindow1, "make_above");
      const makeAbove2 = vi.spyOn(metaWindow2, "make_above");

      wm().restoreAlwaysFloat();

      expect(makeAbove1).toHaveBeenCalled();
      expect(makeAbove2).not.toHaveBeenCalled();
    });

    it("should not make_above if window is already above", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      metaWindow1.above = true;

      const makeAboveSpy = vi.spyOn(metaWindow1, "make_above");

      wm().restoreAlwaysFloat();

      expect(makeAboveSpy).not.toHaveBeenCalled();
    });

    it("should process all floating windows across workspaces", () => {
      const { monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      const metaWindow1 = createMockWindow({ id: 1 });
      const metaWindow2 = createMockWindow({ id: 2 });

      const nodeWindow1 = ctx.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const nodeWindow2 = ctx.tree.createNode(monitor1.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      nodeWindow2.mode = WINDOW_MODES.FLOAT;

      metaWindow1.above = false;
      metaWindow2.above = false;

      const makeAbove1 = vi.spyOn(metaWindow1, "make_above");
      const makeAbove2 = vi.spyOn(metaWindow2, "make_above");

      wm().restoreAlwaysFloat();

      expect(makeAbove1).toHaveBeenCalled();
      expect(makeAbove2).toHaveBeenCalled();
    });

    it("should work correctly after cleanupAlwaysFloat", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      metaWindow1.above = true;

      const unmakeAboveSpy = vi.spyOn(metaWindow1, "unmake_above");
      const makeAboveSpy = vi.spyOn(metaWindow1, "make_above");

      // Cleanup removes above
      wm().cleanupAlwaysFloat();
      expect(unmakeAboveSpy).toHaveBeenCalled();

      // Restore adds it back
      wm().restoreAlwaysFloat();
      expect(makeAboveSpy).toHaveBeenCalled();
    });

    // G2: a pin restoreAlwaysFloat creates is Forge's. Without the flag it is
    // invisible to _reconcileFullscreenFloatDemotion and to `set float(false)`, so
    // it can neither be demoted under a fullscreen window nor cleared by unfloating.
    it("should claim the pin it creates as Forge-owned", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      metaWindow1.above = false;

      wm().restoreAlwaysFloat();

      expect(metaWindow1.is_above()).toBe(true);
      expect(metaWindow1._forgeSetAbove).toBe(true);
    });

    // G2: a pin the USER already applied stays the user's. Claiming it would let a
    // later unfloat remove a pin Forge does not own — the case FR-003 and bug-319
    // exist to prevent.
    it("should not claim a pin the user already applied", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      metaWindow1.above = true;

      wm().restoreAlwaysFloat();

      expect(metaWindow1._forgeSetAbove).toBeFalsy();
    });

    // G2: Bug #289 parity with the `float` setter, which excludes fullscreen windows
    // from the pin. Pinning one puts it above the panel and every dialog.
    it("should not pin a fullscreen float (Bug #289 parity)", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1, fullscreen: true });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      nodeWindow1.mode = WINDOW_MODES.FLOAT;
      metaWindow1.above = false;

      const makeAboveSpy = vi.spyOn(metaWindow1, "make_above");

      wm().restoreAlwaysFloat();

      expect(makeAboveSpy).not.toHaveBeenCalled();
      expect(metaWindow1._forgeSetAbove).toBeFalsy();
    });
  });

  describe("Integration: Float/Unfloat Cycle", () => {
    it("should correctly handle float -> unfloat -> float cycle", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      // Start as tiled
      nodeWindow1.mode = WINDOW_MODES.TILE;

      // Float all
      wm().floatAllWindows();
      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow1.prevFloat).toBeUndefined();

      // Unfloat all
      wm().unfloatAllWindows();
      expect(nodeWindow1.mode).toBe(WINDOW_MODES.TILE);

      // Float again
      wm().floatAllWindows();
      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow1.prevFloat).toBeUndefined(); // Was not floating before
    });

    it("should preserve original floating state through cycle", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const metaWindow1 = createMockWindow({ id: 1 });
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      // Start as floating
      nodeWindow1.mode = WINDOW_MODES.FLOAT;

      // Float all (should mark as prevFloat)
      wm().floatAllWindows();
      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow1.prevFloat).toBe(true);

      // Unfloat all (should keep as floating because of prevFloat)
      wm().unfloatAllWindows();
      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow1.prevFloat).toBe(false); // Marker reset

      // Float again
      wm().floatAllWindows();
      expect(nodeWindow1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(nodeWindow1.prevFloat).toBe(true); // Marked again
    });
  });
});
