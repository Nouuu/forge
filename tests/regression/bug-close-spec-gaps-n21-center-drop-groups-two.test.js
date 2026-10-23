import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
 * close-spec-gaps:N21 (live, 2026-10-23, maintainer): three windows side by side in a
 * split container; a window dropped on the center of one of them, to tab the two, turned
 * the whole container into tabs, so the other windows of the column merged too.
 *
 * Root cause: `_buildDropOperation` (lib/extension/window.js) handled a center drop on a
 * window whose parent is a split CON by targeting the parent itself: the preview covered
 * the whole container and `_executeDropOperation` switched that container to the
 * `dnd-center-layout`. Only a window directly under a monitor got its own group. The user
 * docs (layouts.md, "Drag to tile") say a center drop wraps the two windows.
 *
 * Fix: a center drop in a split CON wraps the target and the dragged window in a new
 * container, as under a monitor, unless the target is the container's only other child,
 * where the container itself takes the layout as before. The preview covers the target.
 */
describe("close-spec-gaps:N21: a center drop groups only the two windows", () => {
  let ctx, monitor;

  function win(id, parent, x, width = 480) {
    const metaWindow = createMockWindow({
      id,
      rect: new Rectangle({ x, y: 0, width, height: 1080 }),
    });
    const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  function host(width = 1440) {
    return createContainerNode(monitor, LAYOUT_TYPES.HSPLIT, { x: 0, y: 0, width, height: 1080 });
  }

  function dropOnCenter(dragged, target, preview = false) {
    ctx.windowManager.renderTree("setup");
    dragged.mode = WINDOW_MODES.GRAB_TILE;
    ctx.windowManager.nodeWinAtPointer = target;
    const r = target.nodeValue.get_frame_rect();
    setPointer(r.x + r.width / 2, r.y + r.height / 2);
    ctx.windowManager.moveWindowToPointer(dragged, preview);
    return r;
  }

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "dnd-center-layout": "tabbed", "showtab-decoration-enabled": true },
    });
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
  });

  afterEach(() => ctx.cleanup());

  it("wraps the target and the dragged window, the other columns stay", () => {
    const column = host();
    const a = win("A", column, 0);
    const b = win("B", column, 480);
    const c = win("C", column, 960);
    const d = win("D", monitor, 1440);

    dropOnCenter(d, b);

    expect(column.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(column.childNodes).toEqual([a, b.parentNode, c]);
    expect(b.parentNode.layout).toBe(LAYOUT_TYPES.TABBED);
    expect(b.parentNode.childNodes).toEqual([b, d]);
  });

  it("uses dnd-center-layout for the new group", () => {
    ctx.settings.set_string("dnd-center-layout", "stacked");
    const column = host();
    win("A", column, 0);
    const b = win("B", column, 480);
    win("C", column, 960);
    const d = win("D", monitor, 1440);

    dropOnCenter(d, b);

    expect(column.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(b.parentNode.layout).toBe(LAYOUT_TYPES.STACKED);
    expect(b.parentNode.childNodes).toEqual([b, d]);
  });

  it("previews the target, not the whole container", () => {
    const column = host();
    win("A", column, 0);
    const b = win("B", column, 480);
    win("C", column, 960);
    const d = win("D", monitor, 1440);
    const show = vi.spyOn(ctx.windowManager, "_showDropPreview");

    const targetRect = dropOnCenter(d, b, true);

    expect(show).toHaveBeenCalled();
    expect(show.mock.calls[0][1].previewRect).toEqual(targetRect);
  });

  it("groups a sibling dropped on its neighbour, the third window stays", () => {
    const column = host();
    const a = win("A", column, 0);
    const b = win("B", column, 480);
    const d = win("D", column, 960);

    dropOnCenter(d, b);

    expect(column.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(column.childNodes).toEqual([a, b.parentNode]);
    expect(b.parentNode.childNodes).toEqual([b, d]);
    expect(b.parentNode.layout).toBe(LAYOUT_TYPES.TABBED);
  });

  it("tabs the container itself when the target is its only other child", () => {
    const column = host(960);
    const b = win("B", column, 0, 960);
    const d = win("D", monitor, 960, 960);

    dropOnCenter(d, b);

    expect(d.parentNode).toBe(column);
    expect(column.layout).toBe(LAYOUT_TYPES.TABBED);
    expect(column.childNodes).toEqual([b, d]);
  });
});
