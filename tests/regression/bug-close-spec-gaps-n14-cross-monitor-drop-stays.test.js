import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * close-spec-gaps:N14 (live batch 2026-10-20, GNOME Wayland, two monitors): a window
 * dragged onto a window of the other monitor took its drop size but landed back on the
 * monitor it left. A second drag landed it.
 *
 * Root cause: `_resolveTargetWorkArea` passed the render rect to
 * `global.display.get_monitor_index_for_rect`, which takes a boxed `Mtk.Rectangle`. The
 * render rect is a plain object (`Tree.processGap`), so GJS threw ("is not a subclass of
 * GObject_Struct"), the catch fell back to the work area of the monitor the window was
 * on, and the forge-aydd clamp pulled the rect back onto that monitor. A window that had
 * not changed monitor during the drag was the case hit; the second drag started from the
 * smaller frame, changed monitor mid-drag, and landed. The Bug #1 tests passed a mock
 * `Rectangle` and the display mock accepted any object, so the fix never ran live.
 *
 * Fix: build an `Mtk.Rectangle` from the rect's four fields. The display mock now throws
 * on a plain object, as GJS does. Monitors side by side: A = {x:0..1920}, B = {x:1920..3840}.
 *
 * Follow-up (review of the fix): every render now reaches the target work area, so it is
 * read from the window's own workspace (`metaWindow.get_workspace()`, then that workspace's
 * `get_work_area_for_monitor`; the Meta.Window API aborts on a window without a workspace,
 * close-spec-gaps:N17), not from the active workspace, whose struts can differ.
 */
describe("close-spec-gaps:N14: a cross-monitor render rect stays on its target monitor", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ globals: { display: { monitorCount: 2 } } });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("keeps a plain rect aimed at the other monitor there", () => {
    const win = createMockWindow({ monitor: 0 });
    // The shape Tree.processGap hands move() from every render.
    ctx.windowManager.move(win, { x: 2000, y: 100, width: 800, height: 600 });

    const frame = win.get_frame_rect();
    expect(frame.x).toBe(2000);
    expect(frame.y).toBe(100);
  });

  it("still clamps a plain rect that overflows its own monitor", () => {
    const win = createMockWindow({ monitor: 1 });
    ctx.windowManager.move(win, { x: 3600, y: 100, width: 300, height: 200 });

    const frame = win.get_frame_rect();
    expect(frame.x + 300).toBeLessThanOrEqual(3840);
    expect(frame.x).toBeGreaterThanOrEqual(1920);
  });

  it("clamps against the work area of the window's own workspace", () => {
    // The active workspace has a 200px strut on B's right edge; the window's does not.
    const ws = ctx.workspaceManager.get_active_workspace();
    ws.get_work_area_for_monitor = (idx) =>
      new Rectangle({ x: idx * 1920, y: 0, width: idx === 1 ? 1720 : 1920, height: 1080 });
    const ownWorkspace = {
      get_work_area_for_monitor: (idx) =>
        new Rectangle({ x: idx * 1920, y: 0, width: 1920, height: 1080 }),
    };
    const win = createMockWindow({ monitor: 1, workspace: ownWorkspace });

    ctx.windowManager.move(win, { x: 3000, y: 100, width: 800, height: 600 });

    expect(win.get_frame_rect().x).toBe(3000);
  });
});
