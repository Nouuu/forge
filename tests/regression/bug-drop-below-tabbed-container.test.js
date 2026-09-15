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
 * Bug drop-below-tabbed-container (2026-09-15, journal 10:31:54–10:32:15): dropping
 * a window on the bottom edge of a tabbed container keeps landing it BESIDE the
 * container; two plain windows split vertically fine.
 *
 * Root cause: for an edge drop on a window inside a STACKED/TABBED container,
 * `_buildDropOperation` always inserted the dragged window as a sibling of that
 * container in the grandparent, and `_executeDropOperation` wrapped the dragged
 * window alone in a CON carrying the edge orientation (`tree.split`). In an HSPLIT
 * monitor a BOTTOM drop therefore produced `[TABBED, VSPLIT[dragged]]` side by side.
 *
 * Fix: when the edge orientation matches the grandparent's layout the window is a
 * plain sibling; when it differs, the tabbed container and the dragged window are
 * wrapped together in a new container with the edge orientation.
 */
describe("Bug drop-below-tabbed-container: an edge drop on a tabbed container splits against it", () => {
  let ctx, monitor, container, tabA, tabB, dragged;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "dnd-center-layout": "TABBED" } });
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    container = createContainerNode(monitor, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 960,
      height: 1080,
    });
    tabA = tab("A");
    tabB = tab("B");
    const metaWindow = createMockWindow({
      id: "D",
      rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
      workspace: ctx.workspaces[0],
    });
    dragged = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    dragged.mode = WINDOW_MODES.GRAB_TILE;
    ctx.windowManager.nodeWinAtPointer = tabA;
  });

  afterEach(() => ctx.cleanup());

  function tab(id) {
    const metaWindow = createMockWindow({
      id,
      rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
      workspace: ctx.workspaces[0],
    });
    const node = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  it("BOTTOM drop wraps the tabbed container and the window in a VSPLIT", () => {
    setPointer(480, 1000);

    ctx.windowManager.moveWindowToPointer(dragged, false);

    expect(monitor.childNodes.length).toBe(1);
    const wrapper = monitor.childNodes[0];
    expect(wrapper.nodeType).toBe(NODE_TYPES.CON);
    expect(wrapper.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(wrapper.childNodes).toEqual([container, dragged]);
    expect(container.layout).toBe(LAYOUT_TYPES.TABBED);
    expect(container.childNodes).toEqual([tabA, tabB]);
  });

  it("TOP drop puts the window above the tabbed container", () => {
    setPointer(480, 50);

    ctx.windowManager.moveWindowToPointer(dragged, false);

    const wrapper = monitor.childNodes[0];
    expect(wrapper.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(wrapper.childNodes).toEqual([dragged, container]);
  });

  it("RIGHT drop in an HSPLIT monitor makes the window a plain sibling of the container", () => {
    setPointer(900, 540);

    ctx.windowManager.moveWindowToPointer(dragged, false);

    expect(monitor.childNodes).toEqual([container, dragged]);
    expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });

  it("a tab dragged below its own container leaves the container as the upper half", () => {
    ctx.windowManager.nodeWinAtPointer = tabB;
    tabA.mode = WINDOW_MODES.GRAB_TILE;
    setPointer(480, 1000);

    ctx.windowManager.moveWindowToPointer(tabA, false);

    const wrapper = monitor.childNodes[0];
    expect(wrapper.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(wrapper.childNodes).toEqual([container, tabA]);
    expect(container.childNodes).toEqual([tabB]);
  });
});
