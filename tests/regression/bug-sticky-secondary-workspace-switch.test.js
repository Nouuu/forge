import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Meta from "gi://Meta";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import * as Utils from "../../lib/extension/utils.js";
import {
  createWindowManagerFixture,
  createWindowNode,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug sticky-secondary-workspace-switch (2026-09-14, branch
 * fix/desktop-workspace-switch-issue): switching workspace on the primary display
 * reorders, resizes, flips or un-tabs the tiling on the secondary display, which
 * itself never changes workspace.
 *
 * Root cause: under the GNOME default `workspaces-only-on-primary=true` Mutter makes
 * every non-primary-monitor window implicitly sticky, and `get_workspace()` on such
 * a window reports the ACTIVE workspace. Forge homed each one under
 * `mo{m}ws{active}`, so (a) windows opened on the secondary from different
 * workspaces scattered across sibling monitor nodes that all render on the same
 * output, (b) any `workspace-changed` on ANY window (Ubuntu's DING extension
 * re-parents its desktop windows on every switch) made `_reconcileWindowHomes`
 * sweep the secondary's windows into `mo{m}ws{new-active}` — appended in
 * breadth-first order, so a `[CON, window]` row came back as `[window, CON]`, with
 * the destination node's own layout/percents — and (c) every `ws{active}`-scoped pass
 * (tab/stack decorations, maximize-on-single) missed them from any other workspace.
 *
 * Fix: `Utils.createMonitorWorkspaceId` — the single home resolver — maps a
 * non-primary monitor to the canonical `mo{m}ws0` whenever
 * `Meta.prefs_get_workspaces_only_on_primary()` is true; the scaffold keeps building
 * raw `mo{m}ws{n}` nodes. `visibleMonitorNodes()` replaces
 * `ws{active}.getNodeByType(MONITOR)` in the active-workspace passes, and the
 * workspace-removed rehome targets `mo{m}ws{removed+1}` when the canonical home sits
 * on the doomed workspace (dynamic workspaces can drop an empty `ws0`).
 */
describe("Bug sticky-secondary-workspace-switch: secondary layouts survive a workspace switch", () => {
  let ctx, tree, wm;
  let ws0, ws1;

  beforeEach(() => {
    Meta.__setWorkspacesOnlyOnPrimary(true);
    ctx = createWindowManagerFixture({
      globals: {
        display: { monitorCount: 2 },
        workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 1 },
      },
      settings: {
        "tiling-mode-enabled": true,
        "showtab-decoration-enabled": true,
        "window-maximize-on-single": true,
      },
    });
    tree = ctx.tree;
    wm = ctx.windowManager;
    [ws0, ws1] = ctx.workspaces;
    vi.spyOn(wm, "renderTree").mockImplementation(() => {});
    vi.spyOn(wm, "trackCurrentMonWs").mockImplementation(() => {});
    for (const id of ["mo0ws0", "mo1ws0", "mo0ws1", "mo1ws1"]) {
      const mon = tree.findNode(id);
      mon.layout = LAYOUT_TYPES.HSPLIT;
      mon.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    }
  });

  afterEach(() => {
    ctx.cleanup();
    Meta.__setWorkspacesOnlyOnPrimary(false);
    vi.restoreAllMocks();
  });

  /** A tiled window on `monitor` whose live workspace is `ws` (sticky ⇒ the active one). */
  function tiled(parent, id, monitor, ws) {
    const { nodeWindow, metaWindow } = createWindowNode(tree, parent, { windowOverrides: { id } });
    metaWindow._monitor = monitor;
    metaWindow._workspace = ws;
    return nodeWindow;
  }

  /** `[CON tabbed (B, C), A]` on the secondary, every window reporting the active ws1. */
  function secondaryRow() {
    const home = tree.findNode("mo1ws0");
    const con = createContainerNode(home, LAYOUT_TYPES.TABBED);
    con.decoration = {
      show: vi.fn(),
      hide: vi.fn(),
      destroy_all_children: vi.fn(),
      destroy: vi.fn(),
      get_parent: () => null,
    };
    const b = tiled(con, "B", 1, ws1);
    const c = tiled(con, "C", 1, ws1);
    const a = tiled(home, "A", 1, ws1);
    expect(home.childNodes).toEqual([con, a]);
    return { home, con, a, b, c };
  }

  it("resolves a non-primary monitor home to ws0 whatever the workspace", () => {
    expect(Utils.createMonitorWorkspaceId(1, 1)).toBe("mo1ws0");
    expect(Utils.createMonitorWorkspaceId(0, 1)).toBe("mo0ws1");
    // The scaffold still owns one node per workspace on every monitor.
    expect(tree.findNode("mo1ws1")).toBeTruthy();

    Meta.__setWorkspacesOnlyOnPrimary(false);
    expect(Utils.createMonitorWorkspaceId(1, 1)).toBe("mo1ws1");
  });

  it("a foreign workspace-changed sweep leaves the secondary row untouched", () => {
    const { home, con, a, b, c } = secondaryRow();
    // Control: a primary window that really moved to ws1 is still re-homed.
    const moved = tiled(tree.findNode("mo0ws0"), "P", 0, ws1);

    wm._reconcileWindowHomes();

    expect(home.childNodes).toEqual([con, a]);
    expect(con.layout).toBe(LAYOUT_TYPES.TABBED);
    expect(con.childNodes).toEqual([b, c]);
    expect(tree.findNode("mo1ws1").getNodeByType(NODE_TYPES.WINDOW)).toEqual([]);
    expect(moved.parentNode).toBe(tree.findNode("mo0ws1"));
  });

  it("a primary row that really migrates keeps its sibling order", () => {
    // Same sweep, genuine move (GNOME shifted ws0 to ws1): [CON, A] must not come
    // back as [A, CON] because the breadth-first walk visited A before B and C.
    const src = tree.findNode("mo0ws0");
    const con = createContainerNode(src, LAYOUT_TYPES.TABBED);
    const b = tiled(con, "B", 0, ws1);
    const c = tiled(con, "C", 0, ws1);
    const a = tiled(src, "A", 0, ws1);
    expect(src.childNodes).toEqual([con, a]);

    wm._reconcileWindowHomes();

    expect(tree.findNode("mo0ws1").childNodes).toEqual([con, a]);
    expect(con.childNodes).toEqual([b, c]);
  });

  it("a secondary window tracked under another workspace's node converges on the canonical home", () => {
    const stray = tiled(tree.findNode("mo1ws1"), "S", 1, ws1);

    wm.updateMetaWorkspaceMonitor("window-entered-monitor", 1, stray.nodeValue);

    expect(stray.parentNode).toBe(tree.findNode("mo1ws0"));
  });

  it("removing workspace 0 keeps the secondary row tiled on the renumbered ws0", () => {
    const { con, a, b, c } = secondaryRow();
    // Mutter has already renumbered: the surviving workspace now reports index 0.
    ws1._index = 0;

    wm._rehomeWorkspaceWindowsBeforeRemoval(0);
    tree.workspaceManager.removeWorkspace(0);
    tree.workspaceManager.renumberWorkspacesAfterRemoval(0);

    const home = tree.findNode("mo1ws0");
    expect(home.childNodes).toEqual([con, a]);
    expect(con.childNodes).toEqual([b, c]);
    expect(tree.findNode("mo1ws1")).toBeNull();
    for (const node of [a, b, c]) expect(tree.findNode(node.nodeValue)).toBe(node);
  });

  it("shows the secondary tab decoration while workspace 1 is active", () => {
    const { con } = secondaryRow();

    wm.updateDecorationLayout();

    expect(con.decoration.show).toHaveBeenCalled();
  });

  it("maximizes a lone secondary window while workspace 1 is active", () => {
    const lone = tiled(tree.findNode("mo1ws0"), "L", 1, ws1);
    const maximize = vi.spyOn(lone.nodeValue, "maximize");

    wm.handleMaximizeOnSingle();

    expect(maximize).toHaveBeenCalled();
  });
});
