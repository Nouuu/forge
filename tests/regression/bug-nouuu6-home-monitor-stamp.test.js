import { describe, it, expect, afterEach, vi } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Nouuu/forge#6: unplugging a screen aborted GNOME Shell (live session 2026-10-07,
 * GNOME 50.1 Wayland): `meta_window_get_work_area_for_logical_monitor: assertion failed:
 * (logical_monitor)` from `move_to_monitor()` in updateMetaWorkspaceMonitor().
 *
 * Root cause: c62894b stamps `_forgeHomeMonitor` in trackWindow() on a window that is
 * not in the tree yet and sits off the focused window's monitor. trackCurrentWindows()
 * (enable, tree reload) runs trackWindow() on every existing window, so all of them got
 * stamped, not only a window that just opened. On the next `window-entered-monitor`
 * Forge moved each one to the stamped monitor; after the unplug that index was gone.
 *
 * Fix: trackCurrentWindows() drops the stamp of every window it re-tracks, and a stamp
 * whose monitor index no longer exists is dropped without a move. A window that just
 * opened keeps its stamp (pinned by bug-new-window-placement-focus).
 */
describe("Nouuu/forge#6: re-tracked windows keep no home-monitor stamp", () => {
  let ctx;

  function setup() {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 2 } },
      settings: { "new-window-placement": "focus" },
    });
    ctx.display.get_current_monitor.mockReturnValue(1);
  }

  afterEach(() => ctx.cleanup());

  const wm = () => ctx.windowManager;
  const focusOn = (monitor) => {
    const focused = createMockWindow({ workspace: ctx.workspaces[0], monitor });
    ctx.display.get_focus_window.mockReturnValue(focused);
    return focused;
  };

  it("does not move an existing window after a re-track", () => {
    setup();
    const focused = focusOn(0);
    const existing = createMockWindow({ workspace: ctx.workspaces[0], monitor: 1 });
    Object.defineProperty(wm(), "windowsAllWorkspaces", {
      get: () => [focused, existing],
      configurable: true,
    });
    wm().trackCurrentWindows();
    const move = vi.spyOn(existing, "move_to_monitor");

    wm().updateMetaWorkspaceMonitor("window-entered-monitor", 1, existing);

    expect(move).not.toHaveBeenCalled();
  });

  it("drops a stamp whose monitor is gone instead of moving to it", () => {
    setup();
    focusOn(1);
    const opened = createMockWindow({ workspace: ctx.workspaces[0], monitor: -1 });
    wm().trackWindow(null, opened);
    // The focus monitor is unplugged before the new window enters a monitor.
    ctx.display.get_n_monitors.mockReturnValue(1);
    opened._monitor = 0;
    const move = vi.spyOn(opened, "move_to_monitor");

    wm().updateMetaWorkspaceMonitor("window-entered-monitor", 0, opened);
    wm().updateMetaWorkspaceMonitor("window-entered-monitor", 0, opened);

    expect(move).not.toHaveBeenCalled();
    expect(wm().findNodeWindow(opened)).toBeTruthy();
  });
});
