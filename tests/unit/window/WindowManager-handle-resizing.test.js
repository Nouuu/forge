import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  finalizeWindow,
} from "../../mocks/helpers/index.js";
import { Rectangle, GrabOp, MotionDirection } from "../../mocks/gnome/Meta.js";
import { Bin } from "../../mocks/gnome/St.js";

/**
 * WindowManager _handleResizing behavior tests
 *
 * Tests for resize operations during grab including:
 * - Horizontal split resizing
 * - Vertical split resizing
 * - Sibling percent adjustment
 * - Stacked/tabbed container resizing
 * - Monitor boundary handling
 * - Edge cases (floating, minimized windows)
 *
 * IMPORTANT: the production resize delta is `get_frame_rect().width - initRect.width`.
 * The mock's get_frame_rect() returns the window's `_rect`, which `move_resize_frame()`
 * updates — so each test simulates the drag by calling move_resize_frame() to the new
 * size (NOT by setting a dead `_frameRect` property), then asserts the resulting
 * node.percent shares actually shifted.
 */
describe("WindowManager - Handle Resizing Behavior", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();

    // Mock Meta namespace for GrabOp and MotionDirection
    global.Meta = { GrabOp, MotionDirection };
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  describe("_handleResizing - Horizontal Split Resizing", () => {
    it("grows the grabbed window and shrinks its split sibling (RESIZING_E)", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.rect = { x: 960, y: 0, width: 960, height: 1080 };

      // Drag the right edge: frame grows 960 -> 1100 (changePx = +140).
      metaWindow1.move_resize_frame(false, 0, 0, 1100, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      expect(nodeWindow1.percent).toBeGreaterThan(0.5);
      expect(nodeWindow2.percent).toBeLessThan(0.5);
      expect(nodeWindow1.percent + nodeWindow2.percent).toBeCloseTo(1, 5);
    });

    it("should call nextVisible to find resize pair", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      metaWindow1.move_resize_frame(false, 0, 0, 1100, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      const nextVisibleSpy = vi.spyOn(ctx.tree, "nextVisible");

      wm()._handleResizing(nodeWindow1);

      expect(nextVisibleSpy).toHaveBeenCalled();
    });

    it("redistributes the resize so sibling percents still sum to 1", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.rect = { x: 960, y: 0, width: 960, height: 1080 };

      metaWindow1.move_resize_frame(false, 0, 0, 1100, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // The grabbed window grew, and the pair absorbed the loss; sum stays ~1.
      expect(nodeWindow1.percent).toBeGreaterThan(0.5);
      const totalPercent = nodeWindow1.percent + nodeWindow2.percent;
      expect(totalPercent).toBeCloseTo(1, 1);
    });

    it("grows the grabbed window and shrinks its left sibling (RESIZING_W)", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.rect = { x: 0, y: 0, width: 960, height: 1080 };

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.initRect = { x: 960, y: 0, width: 960, height: 1080 };
      nodeWindow2.rect = { x: 960, y: 0, width: 960, height: 1080 };
      nodeWindow2.initGrabOp = GrabOp.RESIZING_W;

      // Drag window2's LEFT edge leftward: frame grows 960 -> 1120, x 960 -> 800.
      metaWindow2.move_resize_frame(false, 800, 0, 1120, 1080);

      wm().grabOp = GrabOp.RESIZING_W;
      global.display.get_focus_window.mockReturnValue(metaWindow2);

      wm()._handleResizing(nodeWindow2);

      expect(nodeWindow2.percent).toBeGreaterThan(0.5);
      expect(nodeWindow1.percent).toBeLessThan(0.5);
    });
  });

  describe("_handleResizing - Vertical Split Resizing", () => {
    it("grows the grabbed window and shrinks its split sibling (RESIZING_S)", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 540 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 540, width: 1920, height: 540 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.VSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 1920, height: 540 };
      nodeWindow1.rect = { x: 0, y: 0, width: 1920, height: 540 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_S;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.rect = { x: 0, y: 540, width: 1920, height: 540 };

      // Drag the bottom edge: frame grows 540 -> 700 (changePx = +160).
      metaWindow1.move_resize_frame(false, 0, 0, 1920, 700);

      wm().grabOp = GrabOp.RESIZING_S;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      expect(nodeWindow1.percent).toBeGreaterThan(0.5);
      expect(nodeWindow2.percent).toBeLessThan(0.5);
      expect(nodeWindow1.percent + nodeWindow2.percent).toBeCloseTo(1, 5);
    });

    it("grows the grabbed window and shrinks its top sibling (RESIZING_N)", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 540 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 540, width: 1920, height: 540 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.VSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.rect = { x: 0, y: 0, width: 1920, height: 540 };

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.initRect = { x: 0, y: 540, width: 1920, height: 540 };
      nodeWindow2.rect = { x: 0, y: 540, width: 1920, height: 540 };
      nodeWindow2.initGrabOp = GrabOp.RESIZING_N;

      // Drag window2's TOP edge upward: frame grows 540 -> 680, y 540 -> 400.
      metaWindow2.move_resize_frame(false, 0, 400, 1920, 680);

      wm().grabOp = GrabOp.RESIZING_N;
      global.display.get_focus_window.mockReturnValue(metaWindow2);

      wm()._handleResizing(nodeWindow2);

      expect(nodeWindow2.percent).toBeGreaterThan(0.5);
      expect(nodeWindow1.percent).toBeLessThan(0.5);
    });
  });

  describe("_handleResizing - Stacked/Tabbed Containers", () => {
    // Bug #497 (forge-pak): a tab inside a tabbed/stacked container shares the
    // container's rect, so a sibling tab is never a meaningful resize pair.
    // Resizing a tab must resize the ENCLOSING container against its split
    // sibling. These tests nest the tabbed/stacked container in an HSPLIT next
    // to a plain window and assert the container (not the tab) takes the delta.
    const buildNestedContainer = (containerLayout) => {
      const metaTab1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaTab2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaSibling = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = containerLayout;
      container.percent = 0.5;
      container.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      container.rect = { x: 0, y: 0, width: 960, height: 1080 };

      const tab1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaTab1);
      tab1.mode = WINDOW_MODES.TILE;
      tab1.percent = 0.5;
      tab1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      tab1.rect = { x: 0, y: 0, width: 960, height: 1080 };
      tab1.initGrabOp = GrabOp.RESIZING_E;

      const tab2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaTab2);
      tab2.mode = WINDOW_MODES.TILE;
      tab2.percent = 0.5;
      tab2.rect = { x: 0, y: 0, width: 960, height: 1080 };

      const sibling = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaSibling);
      sibling.mode = WINDOW_MODES.TILE;
      sibling.percent = 0.5;
      sibling.rect = { x: 960, y: 0, width: 960, height: 1080 };

      // Drag tab1's right edge: its frame (== container frame) grows 960 -> 1100.
      metaTab1.move_resize_frame(false, 0, 0, 1100, 1080);
      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaTab1);

      return { container, tab1, tab2, sibling };
    };

    it("resizes a TABBED container against its split sibling, tabs stay valid (Bug #497)", () => {
      const { container, tab1, tab2, sibling } = buildNestedContainer(LAYOUT_TYPES.TABBED);

      wm()._handleResizing(tab1);

      // The container took the delta against its split sibling...
      expect(container.percent).toBeGreaterThan(0.5);
      expect(sibling.percent).toBeLessThan(0.5);
      expect(container.percent + sibling.percent).toBeCloseTo(1, 5);
      // ...and the sibling tabs keep valid positive shares (never collapse).
      expect(tab1.percent).toBeGreaterThan(0);
      expect(tab2.percent).toBeGreaterThan(0);
    });

    it("resizes a STACKED container against its split sibling, tabs stay valid (Bug #497)", () => {
      const { container, tab1, tab2, sibling } = buildNestedContainer(LAYOUT_TYPES.STACKED);

      wm()._handleResizing(tab1);

      expect(container.percent).toBeGreaterThan(0.5);
      expect(sibling.percent).toBeLessThan(0.5);
      expect(container.percent + sibling.percent).toBeCloseTo(1, 5);
      expect(tab1.percent).toBeGreaterThan(0);
      expect(tab2.percent).toBeGreaterThan(0);
    });
  });

  describe("_handleResizing - Skip Invalid Resize Pairs", () => {
    it("skips a floating window and lands the delta on the next tiled sibling", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 640, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow3 = createMockWindow({
        rect: new Rectangle({ x: 1280, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.333;
      nodeWindow1.initRect = { x: 0, y: 0, width: 640, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 640, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      // Window 2 is floating - the immediate right neighbor, must be skipped.
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.FLOAT;
      nodeWindow2.percent = 0.333;
      nodeWindow2.rect = { x: 640, y: 0, width: 640, height: 1080 };

      const nodeWindow3 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow3);
      nodeWindow3.mode = WINDOW_MODES.TILE;
      nodeWindow3.percent = 0.333;
      nodeWindow3.rect = { x: 1280, y: 0, width: 640, height: 1080 };

      metaWindow1.move_resize_frame(false, 0, 0, 800, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // Grabbed window grew; the floating window is left untouched; the delta
      // reached the next TILED sibling (window3), proving window2 was skipped.
      expect(nodeWindow1.percent).toBeGreaterThan(0.333);
      expect(nodeWindow2.percent).toBeCloseTo(0.333, 3);
      expect(Math.abs(nodeWindow3.percent - 0.333)).toBeGreaterThan(0.02);
      expect(nodeWindow1.percent).toBeGreaterThan(nodeWindow3.percent);
    });

    it("skips a minimized window and lands the delta on the next tiled sibling", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 640, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });
      metaWindow2.minimized = true;

      const metaWindow3 = createMockWindow({
        rect: new Rectangle({ x: 1280, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.333;
      nodeWindow1.initRect = { x: 0, y: 0, width: 640, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 640, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.333;
      nodeWindow2.rect = { x: 640, y: 0, width: 640, height: 1080 };

      const nodeWindow3 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow3);
      nodeWindow3.mode = WINDOW_MODES.TILE;
      nodeWindow3.percent = 0.333;
      nodeWindow3.rect = { x: 1280, y: 0, width: 640, height: 1080 };

      metaWindow1.move_resize_frame(false, 0, 0, 800, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // Minimized window2 is skipped; the delta reaches window3.
      expect(nodeWindow1.percent).toBeGreaterThan(0.333);
      expect(nodeWindow2.percent).toBeCloseTo(0.333, 3);
      expect(Math.abs(nodeWindow3.percent - 0.333)).toBeGreaterThan(0.02);
      expect(nodeWindow1.percent).toBeGreaterThan(nodeWindow3.percent);
    });
  });

  describe("_handleResizing - Single Child Container", () => {
    it("should not resize when only one tiled child exists", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 1.0;
      nodeWindow1.initRect = { x: 0, y: 0, width: 1920, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 1920, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      // Even with a real frame delta, a lone tiled child has no resize pair.
      metaWindow1.move_resize_frame(false, 0, 0, 2000, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      const initialPercent = nodeWindow1.percent;

      wm()._handleResizing(nodeWindow1);

      // Percent should remain unchanged with single child
      expect(nodeWindow1.percent).toBe(initialPercent);
    });
  });

  describe("_repositionDuringResize", () => {
    it("should restore x to initRect.x when resizing right edge", () => {
      // Frame has drifted right (x=150) from where the tile started (x=100).
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 150, y: 0, width: 1000, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.initRect = { x: 100, y: 0, width: 960, height: 1080 };

      wm().grabOp = GrabOp.RESIZING_E;

      const moveSpy = vi.spyOn(metaWindow, "move_frame");

      wm()._repositionDuringResize(nodeWindow);

      // Resizing the right edge must pin x back to initRect.x (gaps=0).
      expect(moveSpy).toHaveBeenCalled();
      expect(moveSpy.mock.calls[0][1]).toBe(100);
    });

    it("should restore y to initRect.y when resizing bottom edge", () => {
      // Frame has drifted down (y=150) from where the tile started (y=100).
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 150, width: 1920, height: 600 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.initRect = { x: 0, y: 100, width: 1920, height: 540 };

      wm().grabOp = GrabOp.RESIZING_S;

      const moveSpy = vi.spyOn(metaWindow, "move_frame");

      wm()._repositionDuringResize(nodeWindow);

      // Resizing the bottom edge must pin y back to initRect.y (gaps=0).
      expect(moveSpy).toHaveBeenCalled();
      expect(moveSpy.mock.calls[0][2]).toBe(100);
    });

    it("should not reposition if position has not changed", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 960, height: 540 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.initRect = { x: 100, y: 100, width: 960, height: 540 };

      wm().grabOp = GrabOp.RESIZING_E;

      const moveSpy = vi.spyOn(metaWindow, "move_frame");

      wm()._repositionDuringResize(nodeWindow);

      // Frame x/y already match initRect, so the anti-travel reposition is a no-op.
      expect(moveSpy).not.toHaveBeenCalled();
    });
  });

  describe("_normalizeSiblingPercents", () => {
    it("should normalize percents to sum to 1", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.6;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.6;

      // Total is 1.2, should be normalized
      wm()._normalizeSiblingPercents(monitor);

      const total = nodeWindow1.percent + nodeWindow2.percent;
      expect(total).toBeCloseTo(1, 5);
    });
  });
});

/**
 * F-08 (fork-sync US1, from forge-ext/forge b504512): during a window-system resize grab
 * the neighbours follow the dragged edge live, instead of snapping once on release.
 * Forge's own keyboard resize keeps its 120 ms debounce.
 */
describe("Live resize: neighbours follow a resize grab (F-08)", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { GrabOp, MotionDirection };
    // Each render has finished before the next motion event, as between real pointer
    // motions. (The plain mock runs the callback but returns an id, so renderTree would
    // believe a render is still pending and skip every later one.)
    vi.spyOn(GLib, "idle_add").mockImplementation((_priority, fn) => {
      fn();
      return 0;
    });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  // `n` windows tiled in one container on the monitor, laid out once; the first has focus.
  function tiled(n = 2, layout = LAYOUT_TYPES.HSPLIT) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = layout;
    const metas = [...Array(n)].map(() =>
      createMockWindow({
        workspace: ctx.workspaces[0],
        rect: new Rectangle({ x: 0, y: 0, width: 400, height: 400 }),
      })
    );
    const nodes = metas.map((m) => {
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, m);
      node.mode = WINDOW_MODES.TILE;
      return node;
    });
    wm().renderTree("setup");
    ctx.display.get_focus_window.mockReturnValue(metas[0]);
    return { monitor, metas, nodes };
  }

  // What Mutter does on each motion of the grab: resize the frame, then emit size-changed.
  function drag(meta, { dx = 0, dy = 0 }) {
    const r = meta.get_frame_rect();
    meta._rect = new Rectangle({ x: r.x, y: r.y, width: r.width + dx, height: r.height + dy });
    wm().updateMetaPositionSize(meta, "size-changed");
  }

  const frame = (meta) => {
    const { x, y, width, height } = meta.get_frame_rect();
    return { x, y, width, height };
  };

  // One full grab of the first window's E edge by 300 px, in a fresh fixture. With
  // `live: false` the render is neutralised during the grab, which is today's behaviour.
  function grabScenario({ live, cancel = false }) {
    ctx.cleanup();
    ctx = createWindowManagerFixture();
    const { metas, nodes } = tiled(2);
    const [left] = metas;
    const start = frame(left);
    const moveFrame = vi.spyOn(left, "move_frame");
    wm()._handleGrabOpBegin(ctx.display, left, GrabOp.RESIZING_E);
    const stub = live ? null : vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    drag(left, { dx: 300 });
    if (cancel) {
      left._rect = new Rectangle(start);
      wm().updateMetaPositionSize(left, "size-changed");
    }
    stub?.mockRestore();
    const moveFrameCalls = moveFrame.mock.calls.length;
    wm()._handleGrabOpEnd(ctx.display, left, GrabOp.RESIZING_E);
    return {
      frames: metas.map(frame),
      percents: nodes.map((n) => n.percent),
      moveFrameCalls,
    };
  }

  it("(a) a pointer resize grab narrows the neighbour before the grab ends", () => {
    const { metas } = tiled(2);
    const [left, right] = metas;
    const before = frame(right);
    const render = vi.spyOn(wm(), "renderTree");
    const leftMoves = vi.spyOn(left, "move_resize_frame");
    const rightMoves = vi.spyOn(right, "move_resize_frame");

    wm()._handleGrabOpBegin(ctx.display, left, GrabOp.RESIZING_E);
    drag(left, { dx: 300 });

    expect(render).toHaveBeenCalledWith("size-changed");
    expect(rightMoves).toHaveBeenCalled();
    expect(frame(right).width).toBeLessThan(before.width);
    expect(leftMoves).not.toHaveBeenCalled();
  });

  it("(a) the grabbed window is repositioned only by the resize itself, live or not", () => {
    expect(grabScenario({ live: true }).moveFrameCalls).toBe(
      grabScenario({ live: false }).moveFrameCalls
    );
  });

  it("(b) GNOME's keyboard resize (Alt+F8) renders live too", () => {
    const { metas } = tiled(2);
    const [left, right] = metas;
    const before = frame(right);

    wm()._handleGrabOpBegin(ctx.display, left, GrabOp.KEYBOARD_RESIZING_E);
    drag(left, { dx: 300 });

    expect(frame(right).width).toBeLessThan(before.width);
  });

  it("(c) Forge's keyboard resize still renders only when its debounce fires", () => {
    const { metas } = tiled(2);
    const [left] = metas;
    let debounce = null;
    vi.spyOn(GLib, "timeout_add").mockImplementation((_p, _ms, fn) => {
      debounce = fn;
      return 77;
    });

    wm().resize(GrabOp.KEYBOARD_RESIZING_E, 50);
    const render = vi.spyOn(wm(), "renderTree");
    wm().updateMetaPositionSize(left, "size-changed");
    expect(render).not.toHaveBeenCalled();

    debounce();
    expect(render).toHaveBeenCalled();
  });

  it("(d) the live path adds no timer", () => {
    const { metas } = tiled(2);
    wm()._handleGrabOpBegin(ctx.display, metas[0], GrabOp.RESIZING_E);
    const timers = vi.spyOn(GLib, "timeout_add");

    drag(metas[0], { dx: 300 });

    expect(timers).not.toHaveBeenCalled();
  });

  it("(e) the end state matches today's, live or not", () => {
    expect(grabScenario({ live: true })).toEqual(grabScenario({ live: false }));
  });

  it("(f) a neighbour finalized mid-grab is skipped, nothing throws", () => {
    const { metas } = tiled(2);
    const [left, right] = metas;
    wm()._handleGrabOpBegin(ctx.display, left, GrabOp.RESIZING_E);
    const rightMoves = vi.spyOn(right, "move_resize_frame");
    finalizeWindow(right);

    expect(() => drag(left, { dx: 300 })).not.toThrow();
    expect(rightMoves).not.toHaveBeenCalled();
  });

  it("(g) disabling mid-grab removes the pending live render", () => {
    const { metas } = tiled(2);
    wm()._signalsBound = true; // as after enable(), so disable() reaches its cleanup
    wm()._handleGrabOpBegin(ctx.display, metas[0], GrabOp.RESIZING_E);
    GLib.idle_add.mockImplementation(() => 99); // the live render is still queued
    const remove = vi.spyOn(GLib.Source, "remove");
    drag(metas[0], { dx: 100 });
    expect(wm()._renderTreeSrcId).toBe(99);

    wm().disable();

    expect(remove).toHaveBeenCalledWith(99);
    expect(wm()._renderTreeSrcId).toBe(0);
  });

  it("(h) a tab's grab narrows the plain window beside its tabbed container", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    container.layout = LAYOUT_TYPES.TABBED;
    const tabs = [0, 1].map(() => {
      const meta = createMockWindow({ workspace: ctx.workspaces[0] });
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, meta).mode = WINDOW_MODES.TILE;
      return meta;
    });
    const plain = createMockWindow({ workspace: ctx.workspaces[0] });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, plain).mode = WINDOW_MODES.TILE;
    wm().renderTree("setup");
    ctx.display.get_focus_window.mockReturnValue(tabs[0]);
    const before = frame(plain);

    wm()._handleGrabOpBegin(ctx.display, tabs[0], GrabOp.RESIZING_E);
    drag(tabs[0], { dx: 300 });

    expect(frame(plain).width).toBeLessThan(before.width);
  });

  it("(i) a S-edge grab shortens the window below", () => {
    const { metas } = tiled(2, LAYOUT_TYPES.VSPLIT);
    const [top, bottom] = metas;
    const before = frame(bottom);

    wm()._handleGrabOpBegin(ctx.display, top, GrabOp.RESIZING_S);
    drag(top, { dy: 200 });

    expect(frame(bottom).height).toBeLessThan(before.height);
  });

  it("(j) only the paired neighbour moves in a row of three", () => {
    const { metas } = tiled(3);
    const [a, b, c] = metas;
    const before = frame(b);
    const cMoves = vi.spyOn(c, "move_resize_frame");

    wm()._handleGrabOpBegin(ctx.display, a, GrabOp.RESIZING_E);
    drag(a, { dx: 200 });

    expect(frame(b).width).toBeLessThan(before.width);
    expect(cMoves).not.toHaveBeenCalled();
  });

  it("(k) a grab dragged back to its start ends as it does today", () => {
    expect(grabScenario({ live: true, cancel: true })).toEqual(
      grabScenario({ live: false, cancel: true })
    );
  });

  it("(l) a floating window on the workspace is left alone", () => {
    const { metas } = tiled(2);
    const float = createMockWindow({ workspace: ctx.workspaces[0] });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, float).mode = WINDOW_MODES.FLOAT;
    wm().renderTree("float placed");
    const floatMoves = vi.spyOn(float, "move_resize_frame");

    wm()._handleGrabOpBegin(ctx.display, metas[0], GrabOp.RESIZING_E);
    drag(metas[0], { dx: 300 });

    expect(floatMoves).not.toHaveBeenCalled();
  });

  it("(m) the dragged window closing mid-grab breaks nothing", () => {
    const { metas } = tiled(2);
    const [left, right] = metas;
    wm()._handleGrabOpBegin(ctx.display, left, GrabOp.RESIZING_E);
    finalizeWindow(left);

    // Mutter moves the focus off a window before it is freed.
    ctx.display.get_focus_window.mockReturnValue(right);

    expect(() => {
      wm().updateMetaPositionSize(right, "size-changed");
      wm()._handleGrabOpEnd(ctx.display, left, GrabOp.RESIZING_E);
    }).not.toThrow();
  });

  it("(n) the grab adds no tree-integrity error", () => {
    const { metas } = tiled(2);
    const before = ctx.tree.verifyIntegrity().length;

    wm()._handleGrabOpBegin(ctx.display, metas[0], GrabOp.RESIZING_E);
    drag(metas[0], { dx: 300 });
    wm()._handleGrabOpEnd(ctx.display, metas[0], GrabOp.RESIZING_E);

    expect(ctx.tree.verifyIntegrity().length).toBeLessThanOrEqual(before);
  });

  it("(o) only the grabbed window's own size change renders", () => {
    const { metas } = tiled(2);
    const [left, right] = metas;
    wm()._handleGrabOpBegin(ctx.display, left, GrabOp.RESIZING_E);
    const render = vi.spyOn(wm(), "renderTree");

    wm().updateMetaPositionSize(right, "size-changed");
    wm().updateMetaPositionSize(left, "position-changed");

    expect(render).not.toHaveBeenCalled();
  });
});
