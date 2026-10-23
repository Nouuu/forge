import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createContainerNode,
} from "../mocks/helpers/index.js";
import { Rectangle, MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * close-spec-gaps:N20 (found by the N19 review, 2026-10-23): a window moved with the keyboard
 * out of a two-tab group lost its tab, so its next tab group showed one tab short.
 *
 * Root cause: `Tree._finishMove` collapses the group left with one window, and since N13 the
 * next render destroys the bar of a container that is no longer stacked or tabbed. Clutter
 * destroys an actor's children with it, and the moved window's tab was still in that bar:
 * `removeChild` kept it there, and `_destroyDecoration` only re-creates the tabs of the
 * windows still in the group. The tab's destroy handler cleared `tab`, and nothing re-creates
 * a window tab later.
 *
 * Fix (with N19): `Node.removeChild` takes a window's tab out of the bar it leaves.
 */
describe("close-spec-gaps:N20: a keyboard move out of a tab group keeps the window's tab", () => {
  let ctx, monitor, container, moved, other;

  function win(id, parent, x) {
    const metaWindow = createMockWindow({
      id,
      rect: new Rectangle({ x, y: 0, width: 960, height: 1080 }),
    });
    const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "showtab-decoration-enabled": true } });
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    container = createContainerNode(monitor, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 960,
      height: 1080,
    });
    win("A", container, 0);
    moved = win("B", container, 0);
    other = win("C", monitor, 960);
    ctx.windowManager.renderTree("setup");
  });

  afterEach(() => ctx.cleanup());

  it("keeps the tab of the last tab moved out of the group", () => {
    const tab = moved.tab;
    expect(tab).toBeTruthy();

    ctx.tree.move(moved, MotionDirection.RIGHT);
    ctx.windowManager.renderTree("move");

    expect(moved.parentNode).toBe(monitor);
    expect(container.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(moved.tab).toBe(tab);
  });

  it("shows the moved window's tab in its next group", () => {
    ctx.tree.move(moved, MotionDirection.RIGHT);
    ctx.windowManager.renderTree("move");

    const next = createContainerNode(monitor, LAYOUT_TYPES.TABBED, {
      x: 960,
      y: 0,
      width: 960,
      height: 1080,
    });
    next.appendChild(moved);
    next.appendChild(other);
    ctx.windowManager.renderTree("regroup");

    expect(next.decoration.get_children()).toContain(moved.tab);
    expect(next.decoration.get_children()).toHaveLength(2);
  });
});
