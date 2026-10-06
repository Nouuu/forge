import { describe, it, expect, afterEach } from "vitest";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow, createWindowManagerFixture } from "../../mocks/helpers/index.js";

/**
 * S-17 pin: windowsAllWorkspaces must list every window of every workspace, in
 * stable-sequence order, whether it asks get_tab_list per workspace or once with a
 * NULL workspace (Mutter then lists all windows, each once). The tree that
 * trackCurrentWindows builds from it is the oracle.
 */
describe("WindowManager.windowsAllWorkspaces", () => {
  let ctx;

  afterEach(() => ctx?.cleanup?.());

  function setup() {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 2 }, display: { monitorCount: 2 } },
    });
    const [ws0, ws1] = ctx.workspaces;
    const win = (id, workspace, monitor, extra = {}) =>
      createMockWindow({ id, workspace, monitor, ...extra });
    const a = win(4, ws0, 0);
    const b = win(2, ws0, 1);
    const c = win(5, ws1, 0);
    const d = win(1, ws1, 1);
    const sticky = win(3, ws0, 0, { on_all_workspaces: true });
    const perWorkspace = new Map([
      [ws0, [a, b, sticky]],
      [ws1, [c, d, sticky]],
    ]);
    global.display.get_tab_list.mockImplementation((_type, workspace) =>
      workspace ? perWorkspace.get(workspace) ?? [] : [a, b, c, d, sticky]
    );
    return { wm: ctx.windowManager, all: [a, b, c, d, sticky] };
  }

  it("lists every window of every workspace, sorted by stable sequence", () => {
    const { wm, all } = setup();
    const listed = wm.windowsAllWorkspaces;
    expect(new Set(listed)).toEqual(new Set(all));
    const seq = listed.map((w) => w.get_stable_sequence());
    expect(seq).toEqual([...seq].sort((x, y) => x - y));
  });

  it("tracks the same tree from that list", () => {
    const { wm } = setup();
    wm.trackCurrentWindows();
    const tracked = wm.tree.getNodeByType(NODE_TYPES.WINDOW).map((n) => n.nodeValue.get_id());
    // Recorded on the per-workspace loop before S-17.
    expect(tracked).toEqual([3, 4, 2, 5, 1]);
  });
});
