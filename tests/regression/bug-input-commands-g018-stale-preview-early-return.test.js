import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  finalizeWindow,
  setPointer,
} from "../mocks/helpers/index.js";
import { GrabOp } from "../mocks/gnome/Meta.js";

/**
 * input-commands:G-018: a window-move motion left the last drop preview painted when
 * moveWindowToPointer returned before _showDropPreview.
 *
 * _handleMoving hid the preview only when it had no target or the drag-drop gate was
 * closed. Every other early return of moveWindowToPointer left the zone from the
 * previous motion on screen.
 *
 * Reachable from a real drag: zone NONE. The pointer is read twice per motion, once to
 * find the target and again to detect the zone, and Mutter updates it in between. A move
 * out of the target between the reads returns NONE and left the old zone painted until
 * the next motion. A null target is reachable too, and _handleMoving already hid for it.
 *
 * Not reachable from a real drag, forced here only to pin the fix: a dead target and a
 * detached target (_findNodeWindowAtPointer skips dead windows and resolves through the
 * tree, so it returns neither), no settings (only after disable(), which destroys every
 * hint) and a null drop operation (_buildDropOperation returns an object on every
 * branch). The dead and detached cases stay green without the fix, which proves it.
 *
 * Fix: _handleMoving hides the preview first, then shows it again only if the motion
 * reaches _showDropPreview. The hide and the show run in the same main-loop turn.
 */
describe("input-commands:G-018: no stale preview after an early return", () => {
  let ctx, dragged, target, wm;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "preview-hint-enabled": true } });
    ctx.extension.keybindings = { allowDragDropTile: () => true };
    wm = ctx.windowManager;
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const ws0 = ctx.workspaces[0];
    const d = createWindowNode(ctx.tree, monitor, {
      windowOverrides: { id: "D", workspace: ws0, rect: { x: 0, y: 0, width: 500, height: 500 } },
    });
    const t = createWindowNode(ctx.tree, monitor, {
      windowOverrides: {
        id: "T",
        workspace: ws0,
        rect: { x: 1000, y: 0, width: 800, height: 800 },
      },
    });
    dragged = d.nodeWindow;
    target = t;
    ctx.display.get_focus_window.mockReturnValue(d.metaWindow);
    wm._handleGrabOpBegin(ctx.display, d.metaWindow, GrabOp.MOVING_UNCONSTRAINED);
    // First motion: the left zone of T is painted.
    setPointer(1050, 400);
    wm._handleMoving(dragged);
    expect(dragged.previewHint.visible).toBe(true);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const cases = [
    [
      "zone NONE (pointer leaves T between its two reads, reachable)",
      () => {
        const reads = [[1050, 400]];
        global.get_pointer = vi.fn(() => reads.shift() ?? [2500, 900]);
      },
    ],
    ["null target (reachable)", () => setPointer(2500, 900)],
    [
      "drag-drop gate closed",
      () => (ctx.extension.keybindings = { allowDragDropTile: () => false }),
    ],
    ["dead target (forced)", () => finalizeWindow(target.metaWindow)],
    ["detached target (forced)", () => ctx.tree.removeNode(target.nodeWindow)],
    ["no settings (forced)", () => (ctx.extension.settings = null)],
    [
      "null drop operation (forced)",
      () => vi.spyOn(wm, "_buildDropOperation").mockReturnValue(null),
    ],
  ];

  it.each(cases)("%s hides the preview", (_name, arrange) => {
    arrange();
    wm._handleMoving(dragged);
    expect(dragged.previewHint.visible).toBe(false);
  });
});
