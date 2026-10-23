import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  createContainerNode,
  setPointer,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * close-spec-gaps:N19 (live batch 2026-10-23, GNOME Wayland, two monitors): a tab dragged
 * out of a two-tab group onto a window of the other monitor left the window it left behind
 * alone under a tab bar.
 *
 * Root cause: Mutter moves a dragged window's main monitor once most of its frame crosses,
 * and `window-entered-monitor` re-homes the node at once (`_rehomeWindowPreservingContainer`).
 * That path rebalances the source container but never collapses a stacked or tabbed one
 * left with a single child, as the drop (`_executeDropOperation`) and a keyboard move
 * (`_finishMove`) do. The drop then reads its `previousParent` from the node, which is
 * already the other monitor, so nothing resets the old group: it stays TABBED and the N13
 * render keeps its bar. A tab sent to another workspace takes the same re-home.
 *
 * Monitors side by side: A = {x:0..1920}, B = {x:1920..3840}.
 */
describe("close-spec-gaps:N19: a tab that leaves for another monitor untabs its old group", () => {
  let ctx, container, tabA, tabB, other;

  function win(id, parent, x, width, monitor) {
    const metaWindow = createMockWindow({
      id,
      rect: new Rectangle({ x, y: 0, width, height: 1080 }),
      workspace: ctx.workspaces[0],
      monitor,
    });
    const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: {
        display: { monitorCount: 2 },
        workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 0 },
      },
      settings: {
        "dnd-center-layout": "TABBED",
        "auto-exit-tabbed": true,
        "showtab-decoration-enabled": true,
      },
    });
    const monA = ctx.tree.findNode("mo0ws0");
    const monB = ctx.tree.findNode("mo1ws0");
    container = createContainerNode(monA, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    tabA = win("A", container, 0, 1920, 0);
    tabB = win("B", container, 0, 1920, 0);
    other = win("C", monB, 1920, 1920, 1);
    ctx.windowManager.renderTree("setup");
  });

  afterEach(() => ctx.cleanup());

  it("collapses the old group when a tab enters the other monitor", () => {
    tabA.nodeValue._monitor = 1;

    ctx.windowManager.updateMetaWorkspaceMonitor("window-entered-monitor", 1, tabA.nodeValue);

    expect(container.childNodes).toEqual([tabB]);
    expect(container.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });

  it("leaves no bar after the tab is dropped onto a window of the other monitor", () => {
    const deco = container.decoration;
    expect(deco).toBeTruthy();
    tabA.mode = WINDOW_MODES.GRAB_TILE;
    tabA.nodeValue._monitor = 1;
    ctx.windowManager.updateMetaWorkspaceMonitor("window-entered-monitor", 1, tabA.nodeValue);
    ctx.windowManager.nodeWinAtPointer = other;
    setPointer(2880, 540);

    ctx.windowManager.moveWindowToPointer(tabA, false);
    ctx.windowManager.renderTree("after-drop");

    expect(tabA.parentNode.parentNode).toBe(ctx.tree.findNode("mo1ws0"));
    expect(container.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(container.decoration).toBeNull();
    expect(global.window_group.contains(deco)).toBe(false);
  });

  it("collapses the old group when a tab is sent to another workspace", () => {
    const ws1 = ctx.workspaces[1];
    tabA.nodeValue._workspace = ws1;

    ctx.windowManager._rehomeWindowToLiveLocation(tabA);

    expect(container.childNodes).toEqual([tabB]);
    expect(container.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });
});
