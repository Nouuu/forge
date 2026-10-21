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
 */
describe("close-spec-gaps:N18: a render never acts on a window Mutter has unmanaged", () => {
  const NO_ACTOR = /meta_window_actor_size_change: the window has no actor/;
  const NO_LOGICAL_MONITOR = /assertion failed: \(logical_monitor\)/;

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
  // The fixture display has one monitor.
  const NO_USABLE_MONITOR = [
    ["no monitor", { monitor: -1 }],
    ["a monitor past the display's count", { monitor: 1 }],
  ];
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

    it.each(NO_USABLE_MONITOR)(
      "aborts an unmaximize of a maximized window with %s",
      (_, params) => {
        const win = createMockWindow(params);
        expect(() => win.unmaximize(MaximizeFlags.BOTH)).not.toThrow();
        win.maximize();
        expect(() => win.unmaximize(MaximizeFlags.BOTH)).toThrow(NO_LOGICAL_MONITOR);
        expect(() => win.set_unmaximize_flags(MaximizeFlags.BOTH)).toThrow(NO_LOGICAL_MONITOR);
      }
    );
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

    it.each(NO_USABLE_MONITOR)(
      "Compat.unmaximize calls no Mutter unmaximize for a window with %s",
      (_, params) => {
        const win = createMockWindow(params);
        win.maximize();
        const calls = spyCalls(win, UNMAXIMIZE);

        expect(() => Compat.unmaximize(win)).not.toThrow();

        expect(callsOf(calls)).toEqual([]);
        expect(win.is_maximized()).toBe(true);
      }
    );

    it("both still maximize and unmaximize a live window", () => {
      const win = createMockWindow();
      Compat.maximize(win);
      expect(win.is_maximized()).toBe(true);
      Compat.unmaximize(win);
      expect(win.get_maximized()).toBe(0);
    });
  });
});
