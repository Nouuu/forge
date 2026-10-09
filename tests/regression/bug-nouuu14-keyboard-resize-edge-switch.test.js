import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";
import { GrabOp, MotionDirection, Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Nouuu/forge#14: during GNOME's keyboard resize (Alt+F8), Forge followed only the first
 * edge of the grab.
 *
 * Mutter starts the grab with no edge, picks one at the first arrow key, and changes it
 * in place on a perpendicular arrow (Right then Up goes from E to N). A first pointer
 * motion can also pick a diagonal edge. Forge picked one edge from the frame once and
 * kept it, so after Right then Up the window above did not follow, and the render at the
 * end of the grab put the old height back.
 *
 * Fix: while the grab started with no edge, every motion picks the edge of each axis that
 * moved, and an axis keeps its edge for the rest of the grab.
 */
describe("Nouuu/forge#14: a keyboard resize follows every edge Mutter picks", () => {
  let ctx;
  const ALT_F8 = GrabOp.KEYBOARD_RESIZING_UNKNOWN | 1024;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp, MotionDirection };
    // Each render finishes before the next step, as between real key presses.
    vi.spyOn(GLib, "idle_add").mockImplementation((_priority, fn) => {
      fn();
      return 0;
    });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
    delete global.Meta;
  });

  // [ top / bottom | right ]: a column of two windows beside a third.
  function layout() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const column = new Node(NODE_TYPES.CON, new Bin());
    column.settings = ctx.tree.settings;
    column.layout = LAYOUT_TYPES.VSPLIT;
    monitor.appendChild(column);
    const [top, bottom, right] = [column, column, monitor].map((parent, i) => {
      const meta = createMockWindow({ id: i + 1, workspace: ctx.workspaces[0] });
      const node = new Node(NODE_TYPES.WINDOW, meta);
      node.settings = ctx.tree.settings;
      node.mode = WINDOW_MODES.TILE;
      parent.appendChild(node);
      return meta;
    });
    ctx.windowManager.renderTree("setup");
    return { top, bottom, right };
  }

  // What Mutter does on each step of the grab: move the frame edges, then emit size-changed.
  function resize(meta, { left = 0, right = 0, top = 0, bottom = 0 }) {
    const r = meta.get_frame_rect();
    meta._rect = new Rectangle({
      x: r.x - left,
      y: r.y - top,
      width: r.width + left + right,
      height: r.height + top + bottom,
    });
    ctx.windowManager.updateMetaPositionSize(meta, "size-changed");
  }

  function grab(meta) {
    ctx.display.get_focus_window.mockReturnValue(meta);
    ctx.windowManager._handleGrabOpBegin(ctx.display, meta, ALT_F8);
  }

  const height = (meta) => meta.get_frame_rect().height;
  const width = (meta) => meta.get_frame_rect().width;

  it("Right then Up: the window above follows, and the new height stays", () => {
    const { top, bottom, right } = layout();
    const before = { top: height(top), bottom: height(bottom), right: width(right) };

    grab(bottom);
    resize(bottom, { right: 200 });
    resize(bottom, { top: 100 });

    expect(height(top)).toBeLessThan(before.top);

    ctx.windowManager._handleGrabOpEnd(ctx.display, bottom, GrabOp.KEYBOARD_RESIZING_N | 1024);

    expect(height(bottom)).toBeGreaterThan(before.bottom);
    expect(height(top)).toBeLessThan(before.top);
    expect(width(right)).toBeLessThan(before.right);
  });

  it("a diagonal first motion moves both neighbours", () => {
    const { top, bottom, right } = layout();
    const before = { bottom: height(bottom), right: width(right) };

    grab(top);
    resize(top, { right: 200, bottom: 100 });

    expect(height(bottom)).toBeLessThan(before.bottom);
    expect(width(right)).toBeLessThan(before.right);
  });

  it("an edge taken back to its start ends at its start", () => {
    const { bottom, right } = layout();
    const before = width(right);

    grab(bottom);
    resize(bottom, { right: 200 });
    resize(bottom, { top: 100 });
    resize(bottom, { right: -200 });
    ctx.windowManager._handleGrabOpEnd(ctx.display, bottom, GrabOp.KEYBOARD_RESIZING_E | 1024);

    expect(width(right)).toBe(before);
  });
});
