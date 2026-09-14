import { describe, it, expect, afterEach } from "vitest";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug new-window-placement-focus (2026-09-14): with the focus on the primary display
 * and the pointer resting on the secondary, a new window opens on the secondary.
 *
 * Root cause: `new-window-placement` only offered 'pointer' (the pointer's monitor)
 * and 'window-actual' (wherever Mutter mapped it, which on Wayland is also the
 * pointer's monitor). Nothing homed a new window next to the window the user is
 * actually working in.
 *
 * Fix: a third value, 'focus' — home the new window on the focused window's monitor,
 * falling back to the pointer monitor when nothing is focused.
 */
describe("Bug new-window-placement-focus: 'focus' homes a new window on the focused window's monitor", () => {
  let ctx;

  function setup(focusMonitor) {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 2 } },
      settings: { "new-window-placement": "focus" },
    });
    ctx.display.get_current_monitor.mockReturnValue(1);
    if (focusMonitor !== null) {
      const focused = createMockWindow({ workspace: ctx.workspaces[0], monitor: focusMonitor });
      ctx.display.get_focus_window.mockReturnValue(focused);
    }
  }

  afterEach(() => ctx.cleanup());

  const wm = () => ctx.windowManager;
  const monitorOf = (node) => {
    const { monitor: mon0 } = getWorkspaceAndMonitor(ctx, 0, 0);
    const { monitor: mon1 } = getWorkspaceAndMonitor(ctx, 0, 1);
    if (mon1.contains(node)) return 1;
    if (mon0.contains(node)) return 0;
    return -1;
  };

  it("homes on the focused window's monitor, not the pointer's", () => {
    setup(0);
    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0], monitor: 1 });

    wm().trackWindow(null, metaWindow);

    expect(monitorOf(wm().findNodeWindow(metaWindow))).toBe(0);
  });

  it("falls back to the pointer monitor when nothing is focused", () => {
    setup(null);
    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0], monitor: 0 });

    wm().trackWindow(null, metaWindow);

    expect(monitorOf(wm().findNodeWindow(metaWindow))).toBe(1);
  });
});
