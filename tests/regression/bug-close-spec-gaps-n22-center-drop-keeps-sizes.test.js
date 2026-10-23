import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createContainerNode,
  setPointer,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * close-spec-gaps:N22 (found by the N21 review, 2026-10-23): a center drop reset the sizes
 * the user had set in the target's container: a column at 50/25/25 came back at equal
 * widths. Since N21 a center drop keeps the container's other windows in place, so the
 * reset shows on every tab made inside a resized column.
 *
 * Root cause: `_executeDropOperation` (lib/extension/window.js) zeroes the percent of every
 * child of the target's container before any drop, and a zero percent takes an equal share.
 *
 * Fix: a center drop that wraps the target and the dragged window keeps the container's
 * percents; the new group takes the target's percent. A share the drop frees in that
 * container (the dragged window was a sibling, or the only window of a sibling container
 * that `removeEmptyCon` removes, which also reset the container) is spread over the rest,
 * so the stored percents still sum to 1 and a later resize moves only its own edge
 * (review of the fix).
 */
describe("close-spec-gaps:N22: a center drop keeps the sizes of the target's container", () => {
  let ctx, monitor, column;

  function win(id, parent, x, percent) {
    const metaWindow = createMockWindow({
      id,
      rect: new Rectangle({ x, y: 0, width: 480, height: 1080 }),
    });
    const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    if (percent) node.percent = percent;
    return node;
  }

  function dropOnCenter(dragged, target) {
    ctx.windowManager.renderTree("setup");
    dragged.mode = WINDOW_MODES.GRAB_TILE;
    ctx.windowManager.nodeWinAtPointer = target;
    const r = target.nodeValue.get_frame_rect();
    setPointer(r.x + r.width / 2, r.y + r.height / 2);
    ctx.windowManager.moveWindowToPointer(dragged, false);
    dragged.mode = WINDOW_MODES.TILE;
    ctx.windowManager.renderTree("drop");
  }

  const width = (node) => node.nodeValue.get_frame_rect().width;

  function expectPercents(expected) {
    const got = column.childNodes.map((n) => n.percent);
    expect(got).toHaveLength(expected.length);
    got.forEach((p, i) => expect(p).toBeCloseTo(expected[i], 6));
  }

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "dnd-center-layout": "tabbed", "showtab-decoration-enabled": true },
    });
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    column = createContainerNode(monitor, LAYOUT_TYPES.HSPLIT, {
      x: 0,
      y: 0,
      width: 1440,
      height: 1080,
    });
  });

  afterEach(() => ctx.cleanup());

  it("keeps a 50/25/25 column when a window from elsewhere joins the middle one", () => {
    const a = win("A", column, 0, 0.5);
    const b = win("B", column, 720, 0.25);
    const c = win("C", column, 1080, 0.25);
    const d = win("D", monitor, 1440);

    dropOnCenter(d, b);

    expect(column.childNodes.map((n) => n.percent)).toEqual([0.5, 0.25, 0.25]);
    expect(b.parentNode.parentNode).toBe(column);
    expect(width(a)).toBeGreaterThan(width(c) * 1.8);
  });

  it("scales the rest when a sibling of the same column joins its neighbour", () => {
    const a = win("A", column, 0, 0.5);
    const b = win("B", column, 720, 0.25);
    const d = win("D", column, 1080, 0.25);

    dropOnCenter(d, b);

    expectPercents([2 / 3, 1 / 3]);
    expect(width(a)).toBeGreaterThan(width(b) * 1.8);
  });

  it("keeps the stored percents summing to 1 when three windows stay", () => {
    win("A", column, 0, 0.4);
    const b = win("B", column, 480, 0.2);
    const d = win("D", column, 720, 0.2);
    win("C", column, 960, 0.2);

    dropOnCenter(d, b);

    expectPercents([0.5, 0.25, 0.25]);
  });

  it("keeps the sizes when the dragged window was alone in a sibling container", () => {
    const a = win("A", column, 0, 0.5);
    const b = win("B", column, 720, 0.25);
    const solo = createContainerNode(column, LAYOUT_TYPES.VSPLIT);
    solo.percent = 0.25;
    const d = win("D", solo, 1080);

    dropOnCenter(d, b);

    expect(column.childNodes).toEqual([a, b.parentNode]);
    expectPercents([2 / 3, 1 / 3]);
    expect(width(a)).toBeGreaterThan(width(b) * 1.8);
  });
});
