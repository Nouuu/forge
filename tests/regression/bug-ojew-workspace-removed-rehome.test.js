import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-ojew: lowering the workspace count strands windows when the removed
 * workspace held ALL tracked windows.
 *
 * Mutter relocates windows off the doomed workspace by emitting each window's
 * 'workspace-changed' (which Forge only QUEUES into an idle reconcile), THEN
 * synchronously emits 'workspace-removed'. The synchronous handler calls
 * removeWorkspace -> removeChild, which splices out the ENTIRE workspace subtree
 * INCLUDING its still-unreconciled WINDOW nodes. The later idle reconcile iterates
 * only tree nodes, so the detached windows can no longer be found — and the
 * _onWorkareasChanged recovery only retracks when the tree still has WINDOW nodes,
 * which it doesn't when every window lived on the removed workspace. Result: those
 * windows are permanently stranded until a full reloadTree.
 *
 * Fix: in the 'workspace-removed' handler, synchronously re-home the doomed
 * workspace's WINDOW descendants to the surviving workspace their Meta.Window now
 * reports (mirroring _reconcileWindowHomes), BEFORE removeChild splices the
 * subtree out.
 */
describe("Bug forge-ojew: workspace-removed re-homes windows instead of stranding them", () => {
  let ctx, tree, wm;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 0 } },
    });
    tree = ctx.tree;
    wm = ctx.windowManager;
    // We assert on tree structure only; skip render (unmocked workspace actors).
    vi.spyOn(wm, "renderTree").mockImplementation(() => {});
    vi.spyOn(wm, "trackCurrentMonWs").mockImplementation(() => {});

    for (let i = 0; i < 2; i++) {
      const { monitor } = getWorkspaceAndMonitor(ctx, i, 0);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    }
  });

  afterEach(() => ctx.cleanup());

  /** Build a tiled window node under `parentValue` whose Meta.Window lives on `wsObj`. */
  function addWindow(id, parentValue, wsObj) {
    const win = createMockWindow({ id });
    win._workspace = wsObj;
    win._monitor = 0;
    const node = tree.createNode(parentValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return { win, node };
  }

  it("re-homes windows to the surviving workspace when ALL windows lived on the removed one", () => {
    const { monitor: mon0ws1 } = getWorkspaceAndMonitor(ctx, 1, 0);

    // All tracked windows live (in the tree) on the LAST workspace (ws1).
    const { win: winA, node: nodeA } = addWindow("A", mon0ws1.nodeValue, ctx.workspaces[1]);
    const { win: winB, node: nodeB } = addWindow("B", mon0ws1.nodeValue, ctx.workspaces[1]);

    // ws0 (surviving) currently has no windows.
    const mo0ws0 = tree.findNode("mo0ws0");
    expect(mo0ws0.getNodeByType(NODE_TYPES.WINDOW).length).toBe(0);
    expect(tree.getNodeByType(NODE_TYPES.WINDOW).length).toBe(2);

    // Simulate Mutter: 'workspace-changed' has already moved both windows' live
    // workspace to the surviving ws0 before 'workspace-removed' fires.
    winA._workspace = ctx.workspaces[0];
    winB._workspace = ctx.workspaces[0];

    // Reproduce exactly what the 'workspace-removed' handler does for ws1.
    wm._rehomeWorkspaceWindowsBeforeRemoval(1);
    tree.removeWorkspace(1);
    tree.workspaceManager.renumberWorkspacesAfterRemoval(1);

    // Windows are NOT lost: both still tracked in the tree...
    const remaining = tree.getNodeByType(NODE_TYPES.WINDOW);
    expect(remaining).toContain(nodeA);
    expect(remaining).toContain(nodeB);
    expect(remaining.length).toBe(2);

    // ...and now live under the surviving workspace's monitor node, not detached.
    expect(nodeA.parentNode).toBe(mo0ws0);
    expect(nodeB.parentNode).toBe(mo0ws0);
    expect(mo0ws0.getNodeByType(NODE_TYPES.WINDOW)).toEqual(expect.arrayContaining([nodeA, nodeB]));
  });

  it("re-homes windows when the REMOVED workspace is index 0 and the survivor slides into it", () => {
    // Mutter's workspace indices are GList positions, so removing index k makes
    // every later workspace slide down one. The rehome runs BEFORE
    // renumberWorkspacesAfterRemoval, so it reads a post-removal live index against
    // a still-pre-renumber tree. For k > 0 that is harmless — Mutter relocates to
    // l->prev at k-1, which never renumbers — but for k == 0 the neighbour is
    // l->next, which slides into index 0 and collides with the doomed node's own
    // name. The case above removes index 1, the one arrangement where the stale
    // name is accidentally correct; this one covers k == 0.
    const { monitor: mon0ws0 } = getWorkspaceAndMonitor(ctx, 0, 0);

    // All tracked windows live (in the tree) on the FIRST workspace — the doomed one.
    const { win: winA, node: nodeA } = addWindow("A", mon0ws0.nodeValue, ctx.workspaces[0]);
    const { win: winB, node: nodeB } = addWindow("B", mon0ws0.nodeValue, ctx.workspaces[0]);

    const survivor = tree.findNode("mo0ws1");
    expect(survivor.getNodeByType(NODE_TYPES.WINDOW).length).toBe(0);
    expect(tree.getNodeByType(NODE_TYPES.WINDOW).length).toBe(2);

    // Simulate Mutter: workspace 0 has already left the list, so the survivor
    // (formerly index 1) now reports index 0, and both windows report it as their
    // live workspace. The tree is still pre-renumber: `ws0` is the DOOMED node.
    ctx.workspaces[1]._index = 0;
    winA._workspace = ctx.workspaces[1];
    winB._workspace = ctx.workspaces[1];

    wm._rehomeWorkspaceWindowsBeforeRemoval(0);
    tree.removeWorkspace(0);
    tree.workspaceManager.renumberWorkspacesAfterRemoval(0);

    // Windows are NOT stranded: still tracked, and under the survivor's monitor node.
    const remaining = tree.getNodeByType(NODE_TYPES.WINDOW);
    expect(remaining).toContain(nodeA);
    expect(remaining).toContain(nodeB);
    expect(remaining.length).toBe(2);
    expect(nodeA.parentNode).toBe(survivor);
    expect(nodeB.parentNode).toBe(survivor);
  });
});
