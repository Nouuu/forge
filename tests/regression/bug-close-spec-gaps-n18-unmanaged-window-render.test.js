import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MaximizeFlags, WindowType } from "../mocks/gnome/Meta.js";
import {
  createMockWindow,
  createTiledWindow,
  createWindowManagerFixture,
  createWindowNode,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * close-spec-gaps:N18 (T079 review): a render could act on a window Mutter had unmanaged.
 * A closing window stays in Forge's tree until its actor is destroyed at the end of the
 * close animation, and a render in between could still maximize, unmaximize or move it.
 * The class is the one that aborted GNOME Shell live (close-spec-gaps:N17): a Mutter call
 * that aborts the shell on a window state.
 *
 * `meta_window_unmanage` drops the window's actor (`meta_window_actor_queue_destroy`,
 * window-actor 45: 914, 50: 995), then its maximize flags, its workspace and its monitor
 * (window.c 50: 1552, 1644, 1650, 1671). In Mutter's window.c, 45 to 50:
 * - Maximize-on-single: with `window-maximize-on-single` on, `handleMaximizeOnSingle`
 *   could maximize a lone tile Mutter had unmanaged. A maximize hands the window's actor to
 *   `meta_window_actor_size_change` (45: 2728, 50: 2933), which reads it unchecked: a
 *   segfault without one. A window that still has a monitor but no workspace asserts
 *   earlier, in the work-area read of `meta_window_recalc_features` (50: 6013).
 * - Unmaximize: `meta_window_unmaximize` (45 to 48) and `meta_window_set_unmaximize_flags`
 *   (49, 50) read the current monitor's work area of a maximized window: 45 and 46
 *   dereference a NULL `window->monitor` (45: 3144), 47 to 50 assert `(logical_monitor)`
 *   (47: 3219, 50: 3458). `move()` unmaximizes before it checks the actor.
 *
 * Fix: the render places no window with no actor (`Tree.apply`, the occluded-dialog
 * recentre); `Compat.maximize` refuses a window with no actor, which covers
 * maximize-on-single, and `Compat.unmaximize` one with no monitor. A closing tile still
 * counts in `_tiledWindowsOnMonitor` until it leaves the tree, so the single-tile rules keep
 * their timing (FR-019). Mutter gives every window its actor while it constructs it
 * (window.c 45: 1343, 50: 1451), so no live window is refused. The window double drops its
 * actor in `unmanage()`, and its maximize and unmaximize throw where Mutter aborts.
 *
 * Follow-up (review of the fix): 45 and 46 look the window's monitor up by number to
 * unmaximize it (window.c 45: 3144 then 5827, 46: 3104 then 5805), and the lookup returns
 * NULL for a number past the current count. JS running inside Mutter's monitor-change loop
 * can meet such a window, so `Compat.unmaximize` refuses it too, as `getWorkAreaSafe` does.
 *
 * Follow-up (T082 review): a maximize reads that work area too. Every release calls
 * `meta_window_recalc_features` from `meta_window_maximize_internal` (45: 2665, 50: 2873),
 * which reads the current monitor's work area when the window has a monitor (45: 5657 to
 * 5661, 50: 6009 to 6013): 45 and 46 look the monitor up by number (45: 5863 then 5827, 46:
 * 5841 then 5805), and every release lists the window's workspaces there (45: 5832, 50:
 * 6097), which asserts for a window with none (45: 5405, 50: 5734). An unmaximize reads it
 * the same way. So both shims refuse what `getWorkAreaSafe` refuses: no monitor, a monitor
 * past the count, no workspace. A maximize with no monitor skips the read and the
 * constraints (45: 3865, 50: 4269); it is refused because the window has nowhere to go. The
 * setups build a maximized window as maximized, never through a maximize Mutter would abort.
 *
 * Follow-up (phase 13 review): an unmaximize hands Mutter the actor too. For a window
 * maximized in a direction it clears, `meta_window_unmaximize` (45 to 48) and
 * `meta_window_set_unmaximize_flags` (49, 50) call `meta_window_actor_size_change` (window.c
 * 45: 3219, 47: 3306, 50: 3568), which reads the actor unchecked (window-actor 45: 1080, 50:
 * 1155). Mutter drops the actor before it clears the maximize flags. For a focused window it
 * moves the focus in between, which runs JS (window.c 45: 1450, 1510, 1535; 50: 1552, 1619,
 * 1644). Both shims now share one check, the actor read first:
 * `meta_window_get_compositor_private` returns NULL for a NULL window, and
 * `meta_window_get_monitor` dereferences it (50: 6932, 3985). These rows drop only the actor,
 * since `unmanage()` also clears the monitor and the workspace.
 */
describe("close-spec-gaps:N18: a render never acts on a window Mutter has unmanaged", () => {
  const NO_ACTOR = /meta_window_actor_size_change: the window has no actor/;
  const NO_LOGICAL_MONITOR = /assertion failed: \(logical_monitor\)/;
  const NO_WORKSPACE = /meta_window_get_workspaces: code should not be reached/;

  // Every Mutter call that maximizes, unmaximizes or places a window, and the three
  // work-area reads that abort on a window with no workspace.
  const MUTTER_CALLS = [
    "maximize",
    "set_maximize_flags",
    "unmaximize",
    "set_unmaximize_flags",
    "move_resize_frame",
    "move_frame",
    "move_to_monitor",
    "get_work_area_current_monitor",
    "get_work_area_for_monitor",
    "get_work_area_all_monitors",
  ];
  const UNMAXIMIZE = ["unmaximize", "set_unmaximize_flags"];
  // The states Mutter cannot read a window's work area in, with the abort a read hits. The
  // fixture display has one monitor.
  const NO_MONITOR = ["no monitor", { monitor: -1 }, NO_LOGICAL_MONITOR];
  const STALE_MONITOR = ["a monitor past the display's count", { monitor: 1 }, NO_LOGICAL_MONITOR];
  const WORKSPACE_LESS = ["no workspace", { workspace: null }, NO_WORKSPACE];
  const NO_WORK_AREA = [NO_MONITOR, STALE_MONITOR, WORKSPACE_LESS];
  // Built maximized, so no setup asks the double for a maximize Mutter would abort.
  const maximizedWindow = (params) =>
    createMockWindow({ ...params, maximized_horizontally: true, maximized_vertically: true });
  const spyCalls = (win, names = MUTTER_CALLS) => names.map((name) => vi.spyOn(win, name));
  const callsOf = (spies) => spies.flatMap((spy) => spy.mock.calls);

  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "window-maximize-on-single": true } });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const render = () => ctx.windowManager.renderTree("close-spec-gaps-n18-unmanaged");

  const unmanagedTile = (id) => {
    const tile = createTiledWindow(ctx, { id });
    tile.metaWindow.unmanage();
    return tile;
  };

  const movedWindows = (move) => move.mock.calls.map(([metaWindow]) => metaWindow);

  describe("the window double aborts where Mutter does", () => {
    it("drops its actor, maximize, workspace and monitor when a test unmanages it", () => {
      const win = createMockWindow();
      expect(win.get_compositor_private()).not.toBeNull();
      win.maximize();

      win.unmanage();

      expect(win.get_compositor_private()).toBeNull();
      expect(win.get_maximized()).toBe(0);
      expect(win.get_workspace()).toBeNull();
      expect(win.get_monitor()).toBe(-1);
    });

    it("aborts a maximize of a window with no actor", () => {
      const win = createMockWindow();
      win.unmanage();
      expect(() => win.maximize(MaximizeFlags.BOTH)).toThrow(NO_ACTOR);
      expect(() => win.set_maximize_flags(MaximizeFlags.BOTH)).toThrow(NO_ACTOR);
    });

    // Mutter reads no work area to maximize a window with no monitor.
    it.each([STALE_MONITOR, WORKSPACE_LESS])(
      "aborts a maximize of a window with %s",
      (_, params, abort) => {
        const win = createMockWindow(params);
        expect(() => win.maximize(MaximizeFlags.BOTH)).toThrow(abort);
        expect(() => win.set_maximize_flags(MaximizeFlags.BOTH)).toThrow(abort);
      }
    );

    it.each(NO_WORK_AREA)(
      "aborts an unmaximize of a maximized window with %s",
      (_, params, abort) => {
        expect(() => createMockWindow(params).unmaximize(MaximizeFlags.BOTH)).not.toThrow();
        const win = maximizedWindow(params);
        expect(() => win.unmaximize(MaximizeFlags.BOTH)).toThrow(abort);
        expect(() => win.set_unmaximize_flags(MaximizeFlags.BOTH)).toThrow(abort);
      }
    );

    it("aborts an unmaximize of a maximized window with no actor", () => {
      const restored = createMockWindow();
      restored._actor = null;
      expect(() => restored.unmaximize(MaximizeFlags.BOTH)).not.toThrow();
      const win = maximizedWindow();
      win._actor = null;
      expect(() => win.unmaximize(MaximizeFlags.BOTH)).toThrow(NO_ACTOR);
      expect(() => win.set_unmaximize_flags(MaximizeFlags.BOTH)).toThrow(NO_ACTOR);
    });
  });

  describe("a render with window-maximize-on-single on", () => {
    it("does not maximize a lone tile Mutter has unmanaged", () => {
      const { metaWindow } = unmanagedTile("closing");
      const calls = spyCalls(metaWindow);

      expect(render).not.toThrow();

      expect(metaWindow.get_maximized()).toBe(0);
      expect(callsOf(calls)).toEqual([]);
    });

    it("keeps counting a tile Mutter has unmanaged until it leaves the tree", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const live = createTiledWindow(ctx, { id: "live" });
      const closing = unmanagedTile("closing");

      render();

      expect(ctx.windowManager._tiledWindowsOnMonitor(monitor)).toHaveLength(2);
      expect(live.metaWindow.get_maximized()).toBe(0);
      expect(closing.metaWindow.get_maximized()).toBe(0);

      // The close animation ends: Mutter destroys the actor and Forge drops the node.
      ctx.windowManager.windowDestroy(closing.nodeWindow.windowActor);

      expect(live.metaWindow.is_maximized()).toBe(true);
    });

    it("places the live tile and never hands move() the one Mutter has unmanaged", () => {
      const live = createTiledWindow(ctx, { id: "live" });
      const closing = unmanagedTile("closing");
      const move = vi.spyOn(ctx.windowManager, "move");
      const calls = spyCalls(closing.metaWindow);

      render();

      expect(movedWindows(move)).toContain(live.metaWindow);
      expect(movedWindows(move)).not.toContain(closing.metaWindow);
      expect(callsOf(calls)).toEqual([]);
      const { x, y, width, height } = live.nodeWindow.renderRect;
      expect(live.metaWindow.get_frame_rect()).toMatchObject({ x, y, width, height });
    });

    it("does not recentre a dialog Mutter has unmanaged", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const parent = createTiledWindow(ctx, {
        id: "parent",
        rect: { x: 0, y: 0, width: 960, height: 1080 },
      });
      createTiledWindow(ctx, { id: "neighbor", rect: { x: 960, y: 0, width: 960, height: 1080 } });
      // Mutter placed the dialog over the neighbor, which the forge-2ew recentre corrects.
      const { metaWindow: dialog } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: {
          id: "dialog",
          window_type: WindowType.DIALOG,
          transient_for: parent.metaWindow,
          rect: { x: 1000, y: 400, width: 400, height: 300 },
        },
        mode: "FLOAT",
      });
      dialog.unmanage();
      const move = vi.spyOn(ctx.windowManager, "move");

      render();

      expect(movedWindows(move)).not.toContain(dialog);
      expect(dialog.get_frame_rect()).toMatchObject({ x: 1000, y: 400 });
    });
  });

  it("move() reaches no Mutter unmaximize for a maximized window with no monitor", () => {
    const win = createMockWindow({ monitor: -1 });
    win.maximize();
    const calls = spyCalls(win, UNMAXIMIZE);

    expect(() =>
      ctx.windowManager.move(win, { x: 0, y: 0, width: 960, height: 1080 })
    ).not.toThrow();

    expect(callsOf(calls)).toEqual([]);
  });

  describe.each(["47.0", "50.0"])("the maximize shims on GNOME %s", (version) => {
    let Compat;

    beforeEach(async () => {
      vi.resetModules();
      vi.doMock("resource:///org/gnome/shell/misc/config.js", () => ({
        PACKAGE_VERSION: version,
      }));
      Compat = await import("../../lib/extension/compat.js");
    });

    afterEach(() => {
      vi.doUnmock("resource:///org/gnome/shell/misc/config.js");
    });

    it("Compat.maximize calls no Mutter maximize for a window with no actor", () => {
      const win = createMockWindow();
      win.unmanage();
      const calls = spyCalls(win, ["maximize", "set_maximize_flags"]);

      expect(() => Compat.maximize(win)).not.toThrow();

      expect(callsOf(calls)).toEqual([]);
    });

    it.each(NO_WORK_AREA)(
      "Compat.maximize calls no Mutter maximize for a window with %s",
      (_, params) => {
        const win = createMockWindow(params);
        const calls = spyCalls(win, ["maximize", "set_maximize_flags"]);

        expect(() => Compat.maximize(win)).not.toThrow();

        expect(callsOf(calls)).toEqual([]);
      }
    );

    it.each(NO_WORK_AREA)(
      "Compat.unmaximize calls no Mutter unmaximize for a window with %s",
      (_, params) => {
        const win = maximizedWindow(params);
        const calls = spyCalls(win, UNMAXIMIZE);

        expect(() => Compat.unmaximize(win)).not.toThrow();

        expect(callsOf(calls)).toEqual([]);
        expect(win.is_maximized()).toBe(true);
      }
    );

    it("Compat.maximize refuses a window with no actor before it reads the monitor", () => {
      const win = createMockWindow();
      win._actor = null;
      const calls = spyCalls(win, ["maximize", "set_maximize_flags", "get_monitor"]);

      expect(() => Compat.maximize(win)).not.toThrow();

      expect(callsOf(calls)).toEqual([]);
    });

    it("Compat.unmaximize refuses a maximized window with no actor before it reads the monitor", () => {
      const win = maximizedWindow();
      win._actor = null;
      const calls = spyCalls(win, [...UNMAXIMIZE, "get_monitor"]);

      expect(() => Compat.unmaximize(win)).not.toThrow();

      expect(callsOf(calls)).toEqual([]);
      expect(win.is_maximized()).toBe(true);
    });

    it("both still maximize and unmaximize a live window", () => {
      const win = createMockWindow();
      Compat.maximize(win);
      expect(win.is_maximized()).toBe(true);
      Compat.unmaximize(win);
      expect(win.get_maximized()).toBe(0);
    });
  });
});
