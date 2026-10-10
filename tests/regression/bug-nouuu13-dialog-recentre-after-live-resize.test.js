import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import * as Utils from "../../lib/extension/utils.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { GrabOp, MotionDirection, Rectangle, WindowType } from "../mocks/gnome/Meta.js";

/**
 * Nouuu/forge#13: a transient dialog recentred during a live resize.
 *
 * Every render runs processFloats, which recentres a transient dialog over its parent
 * once a tiled window overlaps it (forge-2ew). Since the live resize (F-08) renders on
 * each step of a resize grab, a neighbour that grew over the dialog moved it in the
 * middle of the drag, and again on later steps. Before F-08 it moved once, on release.
 *
 * Fix: the recentre waits while a window is in a resize grab; the render at the end of
 * the grab does it once.
 */
describe("Nouuu/forge#13: a dialog recentres on release, not during a live resize", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp, MotionDirection };
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  it("holds the dialog still during the grab and recentres it on release", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const [left, right] = [1, 2].map((id) => {
      const meta = createMockWindow({ id, workspace: ctx.workspaces[0] });
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta).mode = WINDOW_MODES.TILE;
      return meta;
    });
    // A dialog of the right window, on its left part.
    const dialog = createMockWindow({
      id: 3,
      workspace: ctx.workspaces[0],
      window_type: WindowType.DIALOG,
      transient_for: right,
      rect: new Rectangle({ x: 1000, y: 400, width: 400, height: 300 }),
    });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dialog);
    const wm = ctx.windowManager;
    wm.renderTree("setup");
    const start = dialog.get_frame_rect();
    expect(Utils.rectsOverlap(start, left.get_frame_rect())).toBe(false);

    // Grow the left window over the dialog.
    ctx.display.get_focus_window.mockReturnValue(left);
    wm._handleGrabOpBegin(ctx.display, left, GrabOp.RESIZING_E);
    const r = left.get_frame_rect();
    left._rect = new Rectangle({ x: r.x, y: r.y, width: r.width + 300, height: r.height });
    wm.updateMetaPositionSize(left, "size-changed");

    expect(Utils.rectsOverlap(dialog.get_frame_rect(), left.get_frame_rect())).toBe(true);
    expect(dialog.get_frame_rect().x).toBe(start.x);

    wm._handleGrabOpEnd(ctx.display, left, GrabOp.RESIZING_E);

    expect(Utils.rectsOverlap(dialog.get_frame_rect(), left.get_frame_rect())).toBe(false);
    expect(Utils.rectsOverlap(dialog.get_frame_rect(), right.get_frame_rect())).toBe(true);
  });
});
