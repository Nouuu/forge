import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  setPointer,
} from "../mocks/helpers/index.js";
import { GrabOp } from "../mocks/gnome/Meta.js";

/**
 * input-commands:G-008: _handleMoving built the preview St.Bin on every hover.
 *
 * _handleMoving created and parented an St.Bin into global.window_group as soon as a
 * window sat under the pointer. It checked allowDragDropTile() only afterwards, and the
 * preview-hint-enabled setting (default false) only later, in _showDropPreview. With the
 * preview off, or the drag-drop gate closed, every drag still built an actor nothing
 * would ever show.
 *
 * Fix: after resolving the target, _handleMoving returns on no target or a closed gate,
 * and builds the preview only when preview-hint-enabled is on.
 */
describe("input-commands:G-008: the drop preview is built only behind its gates", () => {
  let ctx;

  beforeEach(() => {
    ctx = null;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // D is dragged over the left zone of T; returns D and what the motion parented.
  function hover({ preview, gate }) {
    ctx = createWindowManagerFixture({ settings: { "preview-hint-enabled": preview } });
    ctx.extension.keybindings = { allowDragDropTile: () => gate };
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const ws0 = ctx.workspaces[0];
    const { nodeWindow: dragged, metaWindow } = createWindowNode(ctx.tree, monitor, {
      windowOverrides: { id: "D", workspace: ws0, rect: { x: 0, y: 0, width: 500, height: 500 } },
    });
    createWindowNode(ctx.tree, monitor, {
      windowOverrides: {
        id: "T",
        workspace: ws0,
        rect: { x: 1000, y: 0, width: 800, height: 800 },
      },
    });
    ctx.display.get_focus_window.mockReturnValue(metaWindow);
    ctx.windowManager._handleGrabOpBegin(ctx.display, metaWindow, GrabOp.MOVING_UNCONSTRAINED);
    expect(dragged.mode).toBe(WINDOW_MODES.GRAB_TILE);
    setPointer(1050, 400);
    const before = global.window_group.add_child.mock.calls.length;
    ctx.windowManager._handleMoving(dragged);
    return { dragged, bins: global.window_group.add_child.mock.calls.slice(before) };
  }

  it("preview off, gate open: no actor is built", () => {
    const { dragged, bins } = hover({ preview: false, gate: true });
    expect(dragged.previewHint).toBeFalsy();
    expect(bins).toHaveLength(0);
  });

  it("preview on, gate closed: no actor is built", () => {
    const { dragged, bins } = hover({ preview: true, gate: false });
    expect(dragged.previewHint).toBeFalsy();
    expect(bins).toHaveLength(0);
  });

  it("preview on, gate open: one visible actor is built", () => {
    const { dragged, bins } = hover({ preview: true, gate: true });
    expect(bins).toHaveLength(1);
    expect(bins[0][0]).toBe(dragged.previewHint);
    expect(dragged.previewHint.visible).toBe(true);
  });
});
