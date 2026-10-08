import { describe, it, expect, beforeEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Nouuu/forge#12: on Wayland, a window moved to another monitor right after Forge
 * re-tiled it stayed where it was (the multi-monitor gate's monocle and workspace-switch
 * setups, intermittently).
 *
 * Root cause: move() compared the slot with the committed frame only. On Wayland a
 * resize waits for the client, so until it drew, every render sent the same request
 * again. Mutter's move_to_monitor moves that pending slot to the other monitor and
 * sends its own configure (window.c move_between_rects); the next re-send replaced it,
 * and the move was lost.
 *
 * Fix: a request whose client has drawn nothing since is not sent again.
 */
describe("Nouuu/forge#12: a placement still waiting for its client is not sent again", () => {
  let ctx;
  let meta;
  let requests;
  const slot = { x: 645, y: 40, width: 629, height: 1032 };

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    const { monitor } = getWorkspaceAndMonitor(ctx);
    meta = createMockWindow({
      workspace: ctx.workspaces[0],
      rect: new Rectangle({ x: 486, y: 40, width: 470, height: 1032 }),
    });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta).mode = WINDOW_MODES.TILE;
    // Wayland: the frame changes only when the client draws, not on the request.
    requests = vi.spyOn(meta, "move_resize_frame").mockImplementation(() => {});
  });

  it("sends the slot once while the client has not drawn", () => {
    ctx.windowManager.move(meta, slot);
    ctx.windowManager.move(meta, slot);

    expect(requests).toHaveBeenCalledOnce();
  });

  it("sends it again once the client has drawn another frame", () => {
    ctx.windowManager.move(meta, slot);
    meta._rect = new Rectangle({ x: 645, y: 40, width: 600, height: 1032 });
    ctx.windowManager.move(meta, slot);

    expect(requests).toHaveBeenCalledTimes(2);
  });

  it("sends a new slot at once", () => {
    ctx.windowManager.move(meta, slot);
    ctx.windowManager.move(meta, { ...slot, x: 964, width: 948 });

    expect(requests).toHaveBeenCalledTimes(2);
  });
});
