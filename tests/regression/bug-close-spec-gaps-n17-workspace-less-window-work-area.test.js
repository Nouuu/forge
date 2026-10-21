import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * close-spec-gaps:N17 (live 2026-10-21, GNOME 50.1 Wayland, GoLand open): GNOME Shell
 * aborted twice in five minutes, `libmutter:ERROR:../src/core/window.c:6041:
 * meta_window_get_workspaces: code should not be reached`, with the JS stack in
 * `_resolveTargetWorkArea` (lib/extension/window.js) under `move()` from a render.
 *
 * Root cause: close-spec-gaps:N14's follow-up asked the window for its work area,
 * `metaWindow.get_work_area_for_monitor(idx)`. Mutter computes it from
 * `meta_window_get_workspaces()`, which asserts when the window is on no workspace, not
 * on all of them, and not constructing: a window being unmanaged that a render still
 * places.
 *
 * Fix: ask the workspace (the window's own, else the active one), whose work area API has
 * no such assert. The mock window methods below throw, as Mutter aborts: a call to them is
 * the crash.
 */
describe("close-spec-gaps:N17: no window work-area call on a window without a workspace", () => {
  let ctx;

  const abortingWindow = () => {
    const win = createMockWindow({ monitor: 0, workspace: null });
    const abort = () => {
      throw new Error("meta_window_get_workspaces: code should not be reached");
    };
    win.get_work_area_for_monitor = vi.fn(abort);
    win.get_work_area_current_monitor = vi.fn(abort);
    return win;
  };

  beforeEach(() => {
    ctx = createWindowManagerFixture({ globals: { display: { monitorCount: 2 } } });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("places a workspace-less window from a render without asking it for a work area", () => {
    const win = abortingWindow();

    expect(() =>
      ctx.windowManager.move(win, { x: 2000, y: 100, width: 800, height: 600 })
    ).not.toThrow();

    expect(win.get_work_area_for_monitor).not.toHaveBeenCalled();
    expect(win.get_work_area_current_monitor).not.toHaveBeenCalled();
    expect(win.get_frame_rect().x).toBe(2000);
  });
});
