import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  setPointer,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * close-spec-gaps:N15 (live batch 2026-10-20, GNOME Wayland, two monitors): during a drag
 * to the other monitor, the drop preview often never showed, and the drop found no target.
 *
 * Root cause: `trackCurrentMonWs` rebuilds `sortedWindows`, the drag's target list, at grab
 * begin and on every `window-entered-monitor`, mid-drag included. Its guard compared the
 * pointer's monitor and workspace with the focused window's as one boolean for the whole
 * list. Mutter moves a dragged window's main monitor once most of its frame crosses, so a
 * window held on the trailing side of its middle changes monitor while the pointer is
 * still on the old one: the list went empty for the rest of the drag.
 *
 * Fix: the guard keeps its workspace half only. Monitors side by side: A = {x:0..1920},
 * B = {x:1920..3840}.
 */
describe("close-spec-gaps:N15: a drag keeps its targets when the window changes monitor", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ globals: { display: { monitorCount: 2 } } });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("lists the other tiled windows while the pointer trails on the old monitor", () => {
    const ws0 = ctx.workspaces[0];
    const monB = ctx.tree.findNode("mo1ws0");

    const target = createMockWindow({
      id: 2,
      rect: new Rectangle({ x: 1920, y: 0, width: 1920, height: 1080 }),
      workspace: ws0,
      monitor: 1,
    });
    ctx.tree.createNode(monB.nodeValue, NODE_TYPES.WINDOW, target).mode = WINDOW_MODES.TILE;

    // Most of the dragged frame is on B already, so Mutter counts it there.
    const dragged = createMockWindow({
      id: 1,
      rect: new Rectangle({ x: 1500, y: 100, width: 1200, height: 800 }),
      workspace: ws0,
      monitor: 1,
    });
    const draggedNode = ctx.tree.createNode(monB.nodeValue, NODE_TYPES.WINDOW, dragged);
    draggedNode.mode = WINDOW_MODES.GRAB_TILE;

    ctx.display.get_focus_window.mockReturnValue(dragged);
    ctx.display.get_current_monitor.mockReturnValue(0); // the pointer is still on A
    ctx.windowManager.trackCurrentMonWs(); // as the window-entered-monitor handler does

    expect(ctx.windowManager.sortedWindows).toEqual([target]);

    // The pointer then crosses onto the target: it is found.
    ctx.windowManager._grabStartPointer = [1700, 120];
    setPointer(3000, 540);
    expect(ctx.windowManager.findNodeWindowAtPointer(draggedNode)).toBe(
      ctx.tree.getNodeByValue(target)
    );
  });
});
