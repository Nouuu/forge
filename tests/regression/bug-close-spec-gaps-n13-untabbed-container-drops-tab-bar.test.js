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
 * close-spec-gaps:N13: a container that leaves STACKED or TABBED kept its tab bar.
 *
 * Root cause: resetLayoutSingleChild (drag-out), auto-exit-tabbed (tab close) and the
 * layout toggles change `layout` but never destroy `node.decoration`; the decoration
 * manager then shows the stale bar of the now-split container above the window left alone.
 *
 * Fix: Tree.render destroys the decoration of a MONITOR/CON that is neither STACKED nor
 * TABBED; re-tabbing rebuilds it.
 */
describe("close-spec-gaps:N13: an untabbed container drops its tab bar", () => {
  let ctx, monitor, container, tabA, tabB, other;

  function win(id, parent, x, width) {
    const metaWindow = createMockWindow({
      id,
      rect: new Rectangle({ x, y: 0, width, height: 1080 }),
      workspace: ctx.workspaces[0],
    });
    const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "dnd-center-layout": "TABBED",
        "auto-exit-tabbed": true,
        "showtab-decoration-enabled": true,
      },
    });
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    container = createContainerNode(monitor, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 960,
      height: 1080,
    });
    tabA = win("A", container, 0, 960);
    tabB = win("B", container, 0, 960);
    other = win("C", monitor, 960, 960);
    ctx.windowManager.renderTree("setup");
  });

  afterEach(() => ctx.cleanup());

  it("a tab dragged onto another window leaves the old container without a bar", () => {
    expect(container.decoration).toBeTruthy();
    tabA.mode = WINDOW_MODES.GRAB_TILE;
    ctx.windowManager.nodeWinAtPointer = other;
    setPointer(1440, 540);

    ctx.windowManager.moveWindowToPointer(tabA, false);
    ctx.windowManager.renderTree("after-drop");

    expect(container.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(container.decoration).toBeNull();
  });

  it("closing one of two tabs with auto-exit-tabbed leaves no bar", () => {
    expect(container.decoration).toBeTruthy();

    ctx.tree.removeNode(tabA);
    ctx.windowManager.renderTree("after-close");

    expect(container.layout).not.toBe(LAYOUT_TYPES.TABBED);
    expect(container.decoration).toBeNull();
  });

  it("tabbing the container again rebuilds the bar and both tabs", () => {
    container.layout = LAYOUT_TYPES.HSPLIT;
    ctx.windowManager.renderTree("untab");
    expect(container.decoration).toBeNull();

    container.layout = LAYOUT_TYPES.TABBED;
    ctx.windowManager.renderTree("retab");

    expect(container.decoration).toBeTruthy();
    expect(tabA.tab).toBeTruthy();
    expect(tabB.tab).toBeTruthy();
  });
});
