import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { DROP_ZONES } from "../../lib/extension/utils.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";
import { GrabOp, MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Nouuu/forge#4: debug builds logged "tree integrity FAILED (1) from grab-op-end:
 * empty-con" at the end of some drags.
 *
 * Root cause: moving the only window out of a container left that container empty.
 * Both structural moves did it: the drop of a drag (_executeDropOperation) and the
 * keyboard move (tree.move, through _finishMove). The empty container then reached
 * the render, which laid the tree out once, removed it in cleanTree (removeNode resets
 * the ratios of its siblings), and laid the tree out again. The neighbours were placed
 * twice in one render: first with their old ratios, then at equal shares.
 *
 * Fix: the move epilogue removes the container it emptied, so the render lays out once.
 */
describe("Nouuu/forge#4: a move never leaves an empty container", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  function con(parent, layout) {
    const node = new Node(NODE_TYPES.CON, new Bin());
    node.settings = ctx.tree.settings;
    node.layout = layout;
    parent.appendChild(node);
    return node;
  }

  function win(id, parent, percent = 0) {
    const meta = createMockWindow({ id, title: `w${id}`, workspace: ctx.workspaces[0] });
    const node = new Node(NODE_TYPES.WINDOW, meta);
    node.settings = ctx.tree.settings;
    node.mode = WINDOW_MODES.TILE;
    node.percent = percent;
    parent.appendChild(node);
    return node;
  }

  // Drop `dragged` on the right edge of `target`, a direct child of the monitor.
  function dropRightOf(dragged, target, monitor) {
    const drop = {
      nodeWinAtPointer: target,
      parentNodeTarget: monitor,
      horizontal: true,
      isMonParent: true,
      isConParent: false,
      stacked: false,
      stackedOrTabbed: false,
      centerLayout: "SWAP",
      previewRegions: { right: {} },
      targetRect: target.nodeValue.get_frame_rect(),
    };
    const wm = ctx.windowManager;
    dragged.mode = WINDOW_MODES.GRAB_TILE;
    wm._executeDropOperation(dragged, wm._buildDropOperation(DROP_ZONES.RIGHT, drop), target, drop);
    dragged.mode = WINDOW_MODES.TILE;
  }

  it("a drag out of a one-window container leaves no empty container", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = win(1, con(monitor, LAYOUT_TYPES.VSPLIT));
    const b = win(2, monitor);

    dropRightOf(a, b, monitor);

    expect(ctx.tree.verifyIntegrity()).toEqual([]);
  });

  it("a keyboard move out of a one-window container leaves no empty container", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = win(1, con(monitor, LAYOUT_TYPES.VSPLIT));
    win(2, monitor);

    expect(ctx.tree.move(a, MotionDirection.RIGHT)).toBe(true);

    expect(ctx.tree.verifyIntegrity()).toEqual([]);
  });

  it("places the vacated column's windows once in the next render", () => {
    // A sits alone in a container above B and C, which the user sized 0.3 / 0.5.
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const column = con(monitor, LAYOUT_TYPES.VSPLIT);
    const holder = con(column, LAYOUT_TYPES.HSPLIT);
    holder.percent = 0.2;
    const a = win(1, holder);
    const b = win(2, column, 0.3);
    win(3, column, 0.5);
    const d = win(4, monitor);
    ctx.tree.render("setup");

    dropRightOf(a, d, monitor);
    const move = vi.spyOn(ctx.windowManager, "move");
    ctx.tree.render("grab-op-end");

    expect(move.mock.calls.filter(([meta]) => meta === b.nodeValue)).toHaveLength(1);
  });
});
