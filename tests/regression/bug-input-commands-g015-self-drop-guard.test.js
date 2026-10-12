import { describe, it, expect, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  setPointer,
} from "../mocks/helpers/index.js";

/**
 * input-commands:G-015: moveWindowToPointer never checked the target against the dragged window.
 *
 * moveWindowToPointer drops the dragged node relative to nodeWinAtPointer and did not test
 * that the two differ. With the shipped "tabbed" center layout, a drop on the dragged window
 * itself wrapped it in a new single-child TABBED container. Production excludes the dragged
 * window from the hit-test twice, so the bug was latent, but the spec requires the guard.
 *
 * Fix: moveWindowToPointer returns when nodeWinAtPointer is the dragged node.
 */
describe("input-commands:G-015: a window is never dropped onto itself", () => {
  let ctx;

  afterEach(() => {
    ctx.cleanup();
  });

  it.each([
    ["tabbed", 250, 250],
    ["stacked", 250, 250],
    ["swap", 250, 250],
    ["tabbed", 20, 250],
  ])("center layout %s, pointer (%i, %i): the tree is unchanged", (layout, x, y) => {
    ctx = createWindowManagerFixture({ settings: { "dnd-center-layout": layout } });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const { nodeWindow: dragged } = createWindowNode(ctx.tree, monitor, {
      windowOverrides: {
        id: "D",
        workspace: ctx.workspaces[0],
        rect: { x: 0, y: 0, width: 500, height: 500 },
      },
    });
    dragged.mode = WINDOW_MODES.GRAB_TILE;
    ctx.windowManager.nodeWinAtPointer = dragged;
    setPointer(x, y);

    const parent = dragged.parentNode;
    const count = parent.childNodes.length;
    const cons = ctx.tree.getNodeByType(NODE_TYPES.CON).length;

    ctx.windowManager.moveWindowToPointer(dragged, false);

    expect(dragged.parentNode).toBe(parent);
    expect(parent.childNodes).toHaveLength(count);
    expect(ctx.tree.getNodeByType(NODE_TYPES.CON)).toHaveLength(cons);
  });
});
