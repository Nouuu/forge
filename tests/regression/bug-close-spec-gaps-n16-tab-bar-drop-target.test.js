import { describe, it, expect, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import * as Utils from "../../lib/extension/utils.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createContainerNode,
  setPointer,
} from "../mocks/helpers/index.js";
import { GrabOp } from "../mocks/gnome/Meta.js";

/**
 * close-spec-gaps:N16: a window dragged onto the title bar of a stacked or tabbed
 * container showed no preview, and the drop did nothing. Found by the T076 review.
 *
 * Root cause: the child frames of a STACKED or TABBED container exclude its title bar
 * (processStacked, processTabbed). _findNodeWindowAtPointer hit-tested window frames only,
 * so the bar had no target, and moveWindowToPointer took its zone from the target frame,
 * so the zone there was NONE. The bar is the natural place to drop a window to join a tab
 * group, and with default-window-layout tabbed every window sits under one.
 *
 * Fix: when no frame contains the pointer, _findNodeWindowAtPointer returns the top-most
 * window whose stacked or tabbed parent contains it, and moveWindowToPointer turns a NONE
 * zone over that parent into CENTER. A bar drop is a center drop on the container, so
 * dnd-center-layout keeps its meaning.
 *
 * Layout: the monitor (1920x1080, HSPLIT) holds the group (x 0 to 960) with A and B, and
 * D (x 960 to 1920), the dragged window. A bar row is 35 px, no gaps. The mock stacking
 * order puts B on top of A.
 */
describe("close-spec-gaps:N16: a drop on a stacked or tabbed title bar joins the group", () => {
  let ctx, wm, monitor, group, dragged;

  afterEach(() => ctx.cleanup());

  const ids = (node) => node.childNodes.map((c) => (c.isWindow() ? c.nodeValue.id : c.nodeType));

  function win(id, parent) {
    const metaWindow = createMockWindow({ id, workspace: ctx.workspaces[0] });
    const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  function setup(layout, settings = {}) {
    ctx = createWindowManagerFixture({
      settings: { "preview-hint-enabled": true, "dnd-center-layout": "tabbed", ...settings },
    });
    ctx.extension.keybindings = { allowDragDropTile: () => true };
    wm = ctx.windowManager;
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    group = createContainerNode(monitor, layout);
    win("A", group);
    win("B", group);
    dragged = win("D", monitor);
    wm.renderTree("setup");
  }

  // A real drag of D: grab at its center, move to (x, y), release.
  function drag(x, y) {
    const meta = dragged.nodeValue;
    const f = meta.get_frame_rect();
    ctx.display.get_focus_window.mockReturnValue(meta);
    setPointer(f.x + f.width / 2, f.y + f.height / 2);
    wm._handleGrabOpBegin(ctx.display, meta, GrabOp.MOVING_UNCONSTRAINED);
    setPointer(x, y);
    const target = wm.findNodeWindowAtPointer(dragged);
    const frame = target?.nodeValue.get_frame_rect();
    wm._handleMoving(dragged);
    const hint = dragged.previewHint;
    const preview = hint && {
      visible: hint.visible,
      cls: hint.get_style_class_name(),
      rect: { x: hint.x, y: hint.y, width: hint.width, height: hint.height },
    };
    wm._handleGrabOpEnd(ctx.display, meta, GrabOp.MOVING_UNCONSTRAINED);
    return { target: target?.nodeValue.id, frame, preview };
  }

  function expectOffEveryFrame(x, y) {
    const frames = ctx.tree
      .getNodeByType(NODE_TYPES.WINDOW)
      .map((w) => w.nodeValue.get_frame_rect());
    expect(frames.some((f) => Utils.rectContainsPoint(f, [x, y]))).toBe(false);
    expect(Utils.rectContainsPoint(group.rect, [x, y])).toBe(true);
  }

  it.each([
    ["TABBED", "top", 17, "window-tilepreview-tabbed"],
    ["STACKED", "top", 52, "window-tilepreview-stacked"],
    ["TABBED", "bottom", 1062, "window-tilepreview-tabbed"],
    ["STACKED", "bottom", 1027, "window-tilepreview-stacked"],
  ])("%s, bar at the %s: target, preview and join", (layout, position, y, cls) => {
    setup(LAYOUT_TYPES[layout], { "tab-position": position });
    expectOffEveryFrame(480, y);

    const { target, frame, preview } = drag(480, y);

    expect(target).toBe("B");
    const { x, y: fy, width, height } = frame;
    expect(preview).toEqual({ visible: true, cls, rect: { x, y: fy, width, height } });
    expect(ids(group)).toEqual(["A", "B", "D"]);
    expect(group.layout).toBe(LAYOUT_TYPES[layout]);
  });

  it("dnd-center-layout swap: a bar drop swaps D with the target", () => {
    setup(LAYOUT_TYPES.TABBED, { "dnd-center-layout": "swap" });
    expectOffEveryFrame(480, 17);

    const { target } = drag(480, 17);

    expect(target).toBe("B");
    expect(ids(group)).toEqual(["A", "D"]);
    expect(ids(monitor)).toEqual(["CON", "B"]);
  });

  it("a pointer in the gap of a split container still finds no target", () => {
    // Gap 8: A's frame ends at y 532 and B's starts at y 548, inside the VSPLIT group.
    setup(LAYOUT_TYPES.VSPLIT, { "window-gap-size": 8 });
    expectOffEveryFrame(484, 540);

    const { target, preview } = drag(484, 540);

    expect(target).toBeUndefined();
    expect(preview).toBeUndefined();
    expect(ids(group)).toEqual(["A", "B"]);
    expect(ids(monitor)).toEqual(["CON", "D"]);
  });
});
