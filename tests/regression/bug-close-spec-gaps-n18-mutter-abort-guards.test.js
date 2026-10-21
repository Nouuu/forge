import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Utils from "../../lib/extension/utils.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { MotionDirection, Workspace } from "../mocks/gnome/Meta.js";
import {
  createMockWindow,
  createTiledWindow,
  createWindowManagerFixture,
  finalizeWindow,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * close-spec-gaps:N18 (live 2026-10-21, GNOME 50.1 Wayland): GNOME Shell aborted three
 * times, `libmutter:ERROR:../src/core/window.c:6041:meta_window_get_workspaces: code
 * should not be reached`, from a raw `metaWindow.get_work_area_for_monitor` in a render
 * (`_resolveTargetWorkArea`, fixed by close-spec-gaps:N17).
 *
 * Root cause, a class: a Mutter call that aborts the shell on a window state. In Mutter's
 * window.c, on every release from 45 to 50:
 * - `get_work_area_current_monitor`, `get_work_area_for_monitor`,
 *   `get_work_area_all_monitors` and `move_to_monitor` read `meta_window_get_workspaces`,
 *   which asserts for a window on no workspace, not on all of them and not constructing.
 *   `meta_window_unmanage` clears both the workspace and the monitor of a closing window.
 * - `get_work_area_current_monitor` needs a monitor: 45 and 46 dereference a NULL
 *   `window->monitor`, 47 to 50 assert `(logical_monitor)`. `move_to_monitor` reads
 *   `window->monitor->number` on every release.
 * - `get_work_area_for_monitor` and `move_to_monitor` assert `(logical_monitor)` for an
 *   index past the last monitor and leave the area unset for a negative one. The
 *   Meta.Workspace form only logs criticals for such an index.
 * docs/dev/hazards.md named the class, but nothing enforced it: `getWorkAreaSafe` checked
 * the monitor and not the workspace, raw calls sat in render and command paths, and the
 * Meta.Window double never aborted.
 *
 * Fix: guarded helpers in lib/extension/utils.js own every such call (`getWorkAreaSafe`,
 * `getWorkspaceWorkArea`, `getWorkAreaForMonitor`, `moveToMonitorSafe`). Each returns
 * null or false and calls nothing when a precondition fails; every call site goes through
 * them. The double throws where Mutter aborts, and a test window has the active workspace
 * and monitor 0 unless the test removes them.
 *
 * Follow-up (review of the fix): Mutter also looks the window's own monitor up by number
 * (`get_work_area_current_monitor` on 45 and 46, the old-area read of `move_to_monitor` on
 * every release), and the lookup returns NULL for a number past the current count. After a
 * monitor change Mutter updates the windows one at a time (`on_monitors_changed_internal`),
 * so JS running in that loop can meet a window whose monitor is past the count. Both window
 * helpers refuse it.
 *
 * Follow-up (phase 13 review): a move to another monitor hands Mutter the actor too.
 * `move_to_monitor` calls `meta_window_actor_size_change` (window.c 45: 4137, 50: 4610), which
 * reads the actor unchecked (window-actor 45: 1080, 50: 1155). 45 to 49 get there for a window
 * whose rect overlaps its old work area, 50 for a window that is not hidden. A move to the
 * window's own monitor never gets there. `moveToMonitorSafe` checks the actor before anything
 * else, and the double aborts a move to another monitor without one.
 */
describe("close-spec-gaps:N18: every shell-aborting Mutter call goes through a guarded helper", () => {
  const NO_WORKSPACE = /meta_window_get_workspaces: code should not be reached/;
  const NO_LOGICAL_MONITOR = /assertion failed: \(logical_monitor\)/;
  const NEGATIVE_INDEX = /assertion 'which_monitor >= 0' failed/;
  const NO_ACTOR = /meta_window_actor_size_change: the window has no actor/;

  const MUTTER_CALLS = [
    "get_work_area_current_monitor",
    "get_work_area_for_monitor",
    "get_work_area_all_monitors",
    "move_to_monitor",
  ];

  // The two halves of a window Mutter unmanages.
  const BROKEN_STATES = [
    ["no workspace", { workspace: null }],
    ["no monitor", { monitor: -1 }],
  ];

  // The fixture display has two monitors.
  const STALE_MONITOR = ["a monitor past the display's count", { monitor: 2 }];

  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ globals: { display: { monitorCount: 2 } } });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const activeWorkspace = () => ctx.workspaceManager.get_active_workspace();

  describe("the window double aborts where Mutter does", () => {
    it("aborts every call on a window with no workspace", () => {
      const win = createMockWindow({ workspace: null });
      expect(() => win.get_work_area_current_monitor()).toThrow(NO_WORKSPACE);
      expect(() => win.get_work_area_for_monitor(0)).toThrow(NO_WORKSPACE);
      expect(() => win.get_work_area_all_monitors()).toThrow(NO_WORKSPACE);
      expect(() => win.move_to_monitor(1)).toThrow(NO_WORKSPACE);
    });

    it("aborts the calls that read the window's monitor on a window with none", () => {
      const win = createMockWindow({ monitor: -1 });
      expect(() => win.get_work_area_current_monitor()).toThrow(NO_LOGICAL_MONITOR);
      expect(() => win.move_to_monitor(1)).toThrow(/window->monitor/);
      expect(win.get_work_area_for_monitor(1)).toMatchObject({ x: 1920, width: 1920 });
      expect(win.get_work_area_all_monitors()).toMatchObject({ x: 0, width: 3840 });
    });

    it("aborts the indexed calls on an index outside the display's monitors", () => {
      const win = createMockWindow();
      expect(() => win.get_work_area_for_monitor(2)).toThrow(NO_LOGICAL_MONITOR);
      expect(() => win.move_to_monitor(2)).toThrow(NO_LOGICAL_MONITOR);
      expect(() => win.get_work_area_for_monitor(-1)).toThrow(NEGATIVE_INDEX);
      expect(() => win.move_to_monitor(-1)).toThrow(NEGATIVE_INDEX);
    });

    it("aborts the calls that look the window's monitor up on a monitor past the display's count", () => {
      const win = createMockWindow(STALE_MONITOR[1]);
      expect(() => win.get_work_area_current_monitor()).toThrow(NO_LOGICAL_MONITOR);
      expect(() => win.move_to_monitor(1)).toThrow(NO_LOGICAL_MONITOR);
      expect(win.get_work_area_for_monitor(1)).toMatchObject({ x: 1920, width: 1920 });
    });

    it("aborts a move of a window with no actor to another monitor", () => {
      const win = createMockWindow();
      win._actor = null;
      expect(() => win.move_to_monitor(0)).not.toThrow();
      expect(() => win.move_to_monitor(1)).toThrow(NO_ACTOR);
    });

    it("gives a test window the active workspace and monitor 0", () => {
      const win = createMockWindow();
      expect(win.get_workspace()).toBe(activeWorkspace());
      expect(win.get_monitor()).toBe(0);
    });

    it("answers the active workspace for a window on all workspaces, as Mutter does", () => {
      const win = createMockWindow({ workspace: null, on_all_workspaces: true });
      expect(win.get_workspace()).toBe(activeWorkspace());
      expect(() => win.get_work_area_current_monitor()).not.toThrow();
    });
  });

  describe("getWorkAreaSafe", () => {
    it("reads the current monitor's work area of a window with a monitor and a workspace", () => {
      const win = createMockWindow();
      const raw = vi.spyOn(win, "get_work_area_current_monitor");
      expect(Utils.getWorkAreaSafe(win)).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
      expect(raw).toHaveBeenCalledTimes(1);
    });

    it("reads it for a window on all workspaces", () => {
      const win = createMockWindow({ workspace: null, on_all_workspaces: true });
      expect(Utils.getWorkAreaSafe(win)).toMatchObject({ width: 1920, height: 1080 });
    });

    it.each([...BROKEN_STATES, STALE_MONITOR])("refuses a window with %s", (_state, params) => {
      const win = createMockWindow(params);
      const raw = vi.spyOn(win, "get_work_area_current_monitor");
      expect(Utils.getWorkAreaSafe(win)).toBeNull();
      expect(raw).not.toHaveBeenCalled();
    });

    it("refuses no window", () => {
      expect(Utils.getWorkAreaSafe(null)).toBeNull();
    });
  });

  describe("getWorkspaceWorkArea", () => {
    it("reads the workspace's work area for a monitor the display has", () => {
      const raw = vi.spyOn(activeWorkspace(), "get_work_area_for_monitor");
      expect(Utils.getWorkspaceWorkArea(activeWorkspace(), 1)).toMatchObject({ x: 1920 });
      expect(raw).toHaveBeenCalledWith(1);
    });

    it("refuses a missing workspace", () => {
      expect(Utils.getWorkspaceWorkArea(null, 0)).toBeNull();
    });

    it.each([-1, 2])("refuses monitor index %i on a display with two monitors", (index) => {
      const raw = vi.spyOn(activeWorkspace(), "get_work_area_for_monitor");
      expect(Utils.getWorkspaceWorkArea(activeWorkspace(), index)).toBeNull();
      expect(raw).not.toHaveBeenCalled();
    });
  });

  describe("getWorkAreaForMonitor", () => {
    it("reads the window's own workspace, never the window", () => {
      const own = new Workspace({ index: 1 });
      const area = { x: 1920, y: 32, width: 1920, height: 1048 };
      vi.spyOn(own, "get_work_area_for_monitor").mockReturnValue(area);
      const win = createMockWindow({ workspace: own });
      const raw = vi.spyOn(win, "get_work_area_for_monitor");
      expect(Utils.getWorkAreaForMonitor(win, 1)).toBe(area);
      expect(own.get_work_area_for_monitor).toHaveBeenCalledWith(1);
      expect(raw).not.toHaveBeenCalled();
    });

    it("reads the active workspace for a window with no workspace", () => {
      const read = vi.spyOn(activeWorkspace(), "get_work_area_for_monitor");
      const win = createMockWindow({ workspace: null });
      expect(Utils.getWorkAreaForMonitor(win, 1)).toMatchObject({ x: 1920 });
      expect(read).toHaveBeenCalledWith(1);
    });

    it.each([-1, 2])("refuses monitor index %i", (index) => {
      const read = vi.spyOn(activeWorkspace(), "get_work_area_for_monitor");
      expect(Utils.getWorkAreaForMonitor(createMockWindow(), index)).toBeNull();
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("moveToMonitorSafe", () => {
    it("moves a window with a monitor and a workspace to a monitor the display has", () => {
      const win = createMockWindow();
      const raw = vi.spyOn(win, "move_to_monitor");
      expect(Utils.moveToMonitorSafe(win, 1)).toBe(true);
      expect(raw).toHaveBeenCalledWith(1);
      expect(win.get_monitor()).toBe(1);
    });

    it.each([
      ...[...BROKEN_STATES, STALE_MONITOR].map(([state, params]) => [state, params, 1]),
      ["index -1", {}, -1],
      ["index 2", {}, 2],
    ])("refuses %s", (_case, params, index) => {
      const win = createMockWindow(params);
      const raw = vi.spyOn(win, "move_to_monitor");
      expect(Utils.moveToMonitorSafe(win, index)).toBe(false);
      expect(raw).not.toHaveBeenCalled();
    });

    it("refuses a window with no actor before it reads the monitor", () => {
      const win = createMockWindow();
      win._actor = null;
      const raw = vi.spyOn(win, "move_to_monitor");
      const monitor = vi.spyOn(win, "get_monitor");
      expect(Utils.moveToMonitorSafe(win, 1)).toBe(false);
      expect(raw).not.toHaveBeenCalled();
      expect(monitor).not.toHaveBeenCalled();
    });
  });

  describe("call sites", () => {
    const render = () => ctx.windowManager.renderTree("close-spec-gaps-n18");

    it("a render places a tree whose windows are normal, without a workspace, without a monitor, and finalized", () => {
      const normal = createTiledWindow(ctx, { id: "normal" });
      const noWorkspace = createTiledWindow(ctx, { id: "no-workspace", workspace: null });
      const noMonitor = createTiledWindow(ctx, { id: "no-monitor", monitor: -1 });
      const finalized = createTiledWindow(ctx, { id: "finalized" });
      finalizeWindow(finalized.metaWindow);
      // Mutter's abort kills the shell even where a JS catch would swallow the double's throw.
      const calls = [normal, noWorkspace, noMonitor, finalized].flatMap(({ metaWindow }) =>
        MUTTER_CALLS.map((name) => vi.spyOn(metaWindow, name))
      );

      expect(render).not.toThrow();

      const aborts = calls.flatMap((call) => call.mock.results).filter((r) => r.type === "throw");
      expect(aborts).toEqual([]);
      expect(ctx.tree.getNodeByType(NODE_TYPES.WINDOW)).not.toContain(finalized.nodeWindow);
      const { x, y, width, height } = normal.nodeWindow.renderRect;
      expect(normal.metaWindow.get_frame_rect()).toMatchObject({ x, y, width, height });
    });

    it("a render skips a monitor node the display no longer has", () => {
      // Mutter has moved the window off the unplugged monitor; Forge's tree is not rebuilt yet.
      createTiledWindow(ctx, { monitor: 0 }, 0, 1);
      ctx.display.get_n_monitors.mockReturnValue(1);
      const read = vi.spyOn(activeWorkspace(), "get_work_area_for_monitor");

      expect(render).not.toThrow();

      expect(read).not.toHaveBeenCalledWith(1);
    });

    it("the cross-monitor move reads the target work area from the workspace, never the window", () => {
      const { nodeWindow, metaWindow } = createTiledWindow(ctx);
      render();
      const raw = vi.spyOn(metaWindow, "get_work_area_for_monitor");

      expect(ctx.tree.move(nodeWindow, MotionDirection.RIGHT)).toBe(true);

      expect(raw).not.toHaveBeenCalled();
      expect(getWorkspaceAndMonitor(ctx, 0, 1).monitor.contains(nodeWindow)).toBe(true);
      expect(metaWindow.get_frame_rect()).toMatchObject({ x: 1920, width: 1920 });
    });

    it.each(BROKEN_STATES)("rectForMonitor refuses a window with %s", (_state, params) => {
      const { nodeWindow } = createTiledWindow(ctx, params);
      nodeWindow.rect = { x: 0, y: 0, width: 1920, height: 1080 };
      expect(ctx.windowManager.rectForMonitor(nodeWindow, 1)).toBeNull();
    });

    it("the home-monitor return moves a window back to its home monitor", () => {
      const win = createMockWindow({ monitor: 1 });
      win._forgeHomeMonitor = 0;
      ctx.windowManager.updateMetaWorkspaceMonitor("window-entered-monitor", 1, win);
      expect(win.get_monitor()).toBe(0);
    });

    it.each(BROKEN_STATES)("the home-monitor return refuses a window with %s", (_state, params) => {
      const win = createMockWindow({ monitor: 1, ...params });
      win._forgeHomeMonitor = 0;
      const move = vi.spyOn(win, "move_to_monitor");

      expect(() =>
        ctx.windowManager.updateMetaWorkspaceMonitor("window-entered-monitor", 1, win)
      ).not.toThrow();

      expect(move).not.toHaveBeenCalled();
      expect(win._forgeHomeMonitor).toBeUndefined();
    });
  });
});
