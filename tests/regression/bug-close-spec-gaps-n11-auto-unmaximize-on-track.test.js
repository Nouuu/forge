import { describe, it, expect, afterEach } from "vitest";
import {
  createMockWindow,
  createTiledWindow,
  createWindowManagerFixture,
} from "../mocks/helpers/index.js";
import { WindowType } from "../mocks/gnome/Meta.js";

/**
 * close-spec-gaps:N11: auto-unmaximize-for-tiling (default on, a prefs switch) never
 * unmaximized anything.
 *
 * Root cause: trackWindow creates every new node FLOAT (processFloats decides tile or
 * float on the next render) and then calls handleUnmaximizeForTiling, which returned
 * on newNodeWindow.isFloat(). That gate was always true, so the handler was dead since
 * upstream #462 (f3a4578).
 *
 * Fix: decide "will this window tile" with the rule processFloats applies
 * (isFloatingExempt plus the workspace and monitor skip lists, now one helper), and
 * skip while tiling mode is off, since renderTree then tiles nothing.
 */
describe("close-spec-gaps:N11: a new tiling window unmaximizes its tiled neighbours", () => {
  let ctx;

  function setup(settings = {}) {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 2 } },
      settings: { "auto-unmaximize-for-tiling": true, ...settings },
    });
    ctx.display.get_current_monitor.mockReturnValue(0);
  }

  afterEach(() => ctx.cleanup());

  function maximizedTile(monIndex = 0) {
    const { metaWindow } = createTiledWindow(
      ctx,
      { id: `max-${monIndex}`, workspace: ctx.workspaces[0], monitor: monIndex },
      0,
      monIndex
    );
    metaWindow.maximize();
    return metaWindow;
  }

  function openWindow(overrides = {}) {
    const metaWindow = createMockWindow({
      id: "new",
      workspace: ctx.workspaces[0],
      monitor: 0,
      ...overrides,
    });
    ctx.windowManager.trackWindow(null, metaWindow);
  }

  it("unmaximizes a maximized tiled window on the same monitor", () => {
    setup();
    const maximized = maximizedTile();
    openWindow();
    expect(maximized.is_maximized()).toBe(false);
  });

  it("leaves it maximized when the setting is off", () => {
    setup({ "auto-unmaximize-for-tiling": false });
    const maximized = maximizedTile();
    openWindow();
    expect(maximized.is_maximized()).toBe(true);
  });

  it("leaves it maximized when the new window is float-exempt", () => {
    setup();
    const maximized = maximizedTile();
    openWindow({ window_type: WindowType.DIALOG });
    expect(maximized.is_maximized()).toBe(true);
  });

  it("leaves it maximized when the new window lands on a monitor that does not tile", () => {
    setup({ "monitor-skip-tile": "1" });
    const maximized = maximizedTile();
    openWindow({ monitor: 1 });
    expect(maximized.is_maximized()).toBe(true);
  });

  it("leaves a maximized window on another monitor alone", () => {
    setup();
    const maximized = maximizedTile(1);
    openWindow();
    expect(maximized.is_maximized()).toBe(true);
  });

  it("leaves it maximized while tiling mode is off", () => {
    setup({ "tiling-mode-enabled": false });
    const maximized = maximizedTile();
    openWindow();
    expect(maximized.is_maximized()).toBe(true);
  });
});
