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
 * Nouuu/forge#10: on a two-monitor Wayland session, windows jumped onto the other
 * monitor. Live: after an unplug and replug, a window on a hidden workspace of the
 * laptop screen landed on the external one. CI: the multi-monitor gate's
 * test_workspace_switch_keeps_secondary_layout, red on and off since 2026-09-10, where
 * a window moved back to the active workspace landed on the secondary monitor.
 *
 * Root cause: move() placed a window in two requests, move_frame(x, y) then
 * move_resize_frame(x, y, w, h). Mutter applies a pure move at once with the size the
 * client last committed, while a resize waits for the client and then lands together
 * with its position. So a window showed its new position with its old size:
 * - the returning window still had the full width of its earlier layout, and its new x
 *   with that width put its centre on the secondary monitor;
 * - the hidden window took its single-monitor position during the unplug at once (its
 *   client does not draw while hidden), and after the replug that spot lay on the
 *   external monitor.
 * Mutter then reported window-entered-monitor and Forge re-homed the window there.
 *
 * Fix: one move_resize_frame request, so position and size reach the screen together.
 */
describe("Nouuu/forge#10: a placement never shows the new position with the old size", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  it("keeps every frame on the way inside the target monitor", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    // The client still shows the full width of the window's previous layout.
    const meta = createMockWindow({
      workspace: ctx.workspaces[0],
      rect: new Rectangle({ x: 8, y: 40, width: 1904, height: 1032 }),
    });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta).mode = WINDOW_MODES.TILE;

    // The frame the window shows after each request Forge sends.
    const frames = [];
    for (const name of ["move_frame", "move_resize_frame"]) {
      const real = meta[name].bind(meta);
      vi.spyOn(meta, name).mockImplementation((...args) => {
        real(...args);
        const { x, width } = meta.get_frame_rect();
        frames.push({ x, width });
      });
    }

    // Its slot is the right third of the primary monitor (x 0-1920 in this fixture).
    ctx.windowManager.move(meta, { x: 1282, y: 40, width: 630, height: 1032 });

    expect(frames.at(-1)).toEqual({ x: 1282, width: 630 });
    for (const { x, width } of frames) expect(x + width / 2).toBeLessThan(1920);
  });
});
