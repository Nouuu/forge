import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createMockWindow,
  createTiledWindow,
  createWindowManagerFixture,
} from "../mocks/helpers/index.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";

/**
 * close-spec-gaps:N12: a maximized window floated at the next render. The N11 e2e run
 * (CI 39043874478, on 57008e0) saw it on every lane: with window-maximize-on-single on,
 * each lone window was maximized, then floated, so the second window never tiled
 * beside the first.
 *
 * Root cause: Mutter's meta_window_allows_resize is false while a window is maximized
 * on both axes or fullscreen, on every release from 45 to 50 (a one-axis edge snap
 * keeps it true). isFloatingExempt floats a window whose allows_resize() is false (the
 * Bug #294 non-resizable rule), so processFloats floated every maximized or fullscreen
 * tile. The Meta mock returned a constant, so no unit test could see it.
 *
 * Fix: the mock models Mutter, and isFloatingExempt counts a window as non-resizable
 * only when it is neither maximized nor fullscreen. A non-resizable window still floats.
 */
describe("close-spec-gaps:N12: a maximized window stays tiled", () => {
  let ctx;
  let queued;

  function setup(settings = {}) {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, ...settings },
    });
    queued = [];
    vi.spyOn(ctx.windowManager, "queueEvent").mockImplementation((e) => queued.push(e));
  }

  afterEach(() => ctx.cleanup());

  const render = () => ctx.windowManager.renderTree("test");

  // A window-created, then the queued window-create render.
  function openWindow(overrides = {}) {
    const metaWindow = createMockWindow({
      id: "new",
      workspace: ctx.workspaces[0],
      monitor: 0,
      ...overrides,
    });
    ctx.windowManager.trackWindow(null, metaWindow);
    queued.splice(0).forEach((e) => e.callback());
    return { metaWindow, node: ctx.tree.findNode(metaWindow) };
  }

  function lonelyTile() {
    return createTiledWindow(ctx, { id: "tile", workspace: ctx.workspaces[0], monitor: 0 });
  }

  it("a lone window maximized by window-maximize-on-single stays tiled", () => {
    setup({ "window-maximize-on-single": true });
    const { metaWindow, node } = openWindow();
    expect(metaWindow.is_maximized()).toBe(true);
    render();
    expect(node.mode).toBe(WINDOW_MODES.TILE);
    expect(metaWindow.is_maximized()).toBe(true);
  });

  it("a lone tile the user maximizes stays tiled", () => {
    setup();
    const { metaWindow, nodeWindow } = lonelyTile();
    metaWindow.maximize();
    render();
    render();
    expect(nodeWindow.mode).toBe(WINDOW_MODES.TILE);
    expect(metaWindow.is_maximized()).toBe(true);
  });

  it("a fullscreen tile stays tiled", () => {
    setup();
    const { metaWindow, nodeWindow } = lonelyTile();
    metaWindow.make_fullscreen();
    render();
    expect(nodeWindow.mode).toBe(WINDOW_MODES.TILE);
  });

  it("a non-resizable window still floats (Bug #294)", () => {
    setup();
    const { node } = openWindow({ allows_resize: false });
    render();
    expect(node.mode).toBe(WINDOW_MODES.FLOAT);
  });
});
