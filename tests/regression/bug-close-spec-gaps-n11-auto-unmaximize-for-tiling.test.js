import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createContainerNode,
  createMockWindow,
  createTiledWindow,
  createWindowManagerFixture,
  finalizeWindow,
} from "../mocks/helpers/index.js";
import { GrabOp, MaximizeFlags, WindowType } from "../mocks/gnome/Meta.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";

/**
 * close-spec-gaps:N11: auto-unmaximize-for-tiling (default on, a prefs switch) did not
 * do what it says. Off was meant to keep a maximized window maximized when a new
 * window tiles beside it, but the neighbour was unmaximized either way.
 *
 * Root cause: handleUnmaximizeForTiling never acted. trackWindow creates every node
 * FLOAT until processFloats runs, and the handler returned at its isFloat() gate. Only
 * the window-create render decided: move(), the render's only unmaximizer, re-sliced
 * the neighbour whatever the setting, and forge-dyt2 kept only a lone tile maximized.
 *
 * Fix: one decision, at render time, once processFloats knows the new window tiles.
 * The track-time handler is gone. _keepsMaximize (was _isLoneMaximizedTile) keeps a
 * lone tile's maximize and, while the setting is off, a full (both-axis) maximize.
 * _shouldRejectExternalMaximize (Bug #461) rejects every other maximized, non-fullscreen
 * tile, so a kept window survives its next size change and a one-axis edge snap is
 * still re-tiled. While off, a swap or a keyboard move unmaximizes the window it
 * moves, and a keyboard resize re-tiles a kept maximize instead of resizing from its
 * maximized frame, which would skew the split (forge-v4wh). expand() (WindowExpand, and
 * WindowShrink through shrink()) had no such guard and re-sliced the hidden split while the
 * window stayed maximized; it now takes the same guard.
 *
 * forge-z9ky's pin went with handleUnmaximizeForTiling, but its case stays here: trackWindow
 * still reads each tiled sibling (insertChildPercent), and the render prunes a dead one.
 */
describe("close-spec-gaps:N11: auto-unmaximize-for-tiling decides the neighbour's maximize", () => {
  let ctx;
  let queued;

  function setup(settings = {}) {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 2 } },
      settings: { "tiling-mode-enabled": true, ...settings },
    });
    ctx.display.get_current_monitor.mockReturnValue(0);
    queued = [];
    vi.spyOn(ctx.windowManager, "queueEvent").mockImplementation((e) => queued.push(e));
  }

  afterEach(() => ctx.cleanup());

  function maximizedTile(monIndex = 0) {
    const { metaWindow, nodeWindow } = createTiledWindow(
      ctx,
      { id: `max-${monIndex}`, workspace: ctx.workspaces[0], monitor: monIndex },
      0,
      monIndex
    );
    metaWindow.maximize();
    return { metaWindow, nodeWindow };
  }

  // A window-created, then the queued window-create render.
  function openWindow(overrides = {}, beforeRender = () => {}) {
    const metaWindow = createMockWindow({
      id: "new",
      workspace: ctx.workspaces[0],
      monitor: 0,
      ...overrides,
    });
    ctx.windowManager.trackWindow(null, metaWindow);
    beforeRender(metaWindow);
    queued.splice(0).forEach((e) => e.callback());
    return ctx.tree.findNode(metaWindow);
  }

  it("on: the neighbour is unmaximized once the new window tiles", () => {
    setup({ "auto-unmaximize-for-tiling": true });
    const { metaWindow } = maximizedTile();
    const node = openWindow();
    expect(node.mode).toBe(WINDOW_MODES.TILE);
    expect(metaWindow.is_maximized()).toBe(false);
  });

  it("off: the neighbour stays maximized beside the new tiled window", () => {
    setup({ "auto-unmaximize-for-tiling": false });
    const { metaWindow } = maximizedTile();
    const node = openWindow();
    expect(node.mode).toBe(WINDOW_MODES.TILE);
    expect(metaWindow.is_maximized()).toBe(true);
  });

  // Wayland: window-created fires before the client sends its title and app id.
  it.each([
    [true, false],
    [false, true],
  ])("a window whose title and class land after it maps: on=%s keeps=%s", (on, keeps) => {
    setup({ "auto-unmaximize-for-tiling": on });
    const { metaWindow } = maximizedTile();
    const node = openWindow({ title: null, wm_class: null }, (w) => {
      w.set_wm_class("org.gnome.TextEditor");
      w.set_title("Untitled");
    });
    expect(node.mode).toBe(WINDOW_MODES.TILE);
    expect(metaWindow.is_maximized()).toBe(keeps);
  });

  it("on: a fullscreen neighbour keeps its maximize", () => {
    setup({ "auto-unmaximize-for-tiling": true });
    const { metaWindow } = maximizedTile();
    metaWindow.make_fullscreen();
    openWindow();
    expect(metaWindow.is_maximized()).toBe(true);
  });

  it("on: a float-exempt new window leaves the lone neighbour maximized", () => {
    setup({ "auto-unmaximize-for-tiling": true });
    const { metaWindow } = maximizedTile();
    openWindow({ window_type: WindowType.DIALOG });
    expect(metaWindow.is_maximized()).toBe(true);
  });

  it("on: a maximized window on another monitor stays maximized", () => {
    setup({ "auto-unmaximize-for-tiling": true });
    const { metaWindow } = maximizedTile(1);
    openWindow();
    expect(metaWindow.is_maximized()).toBe(true);
  });

  // updateMetaPositionSize ends with the decoration layout; stub the UI bits.
  function sizeChanged(metaWindow) {
    const wm = ctx.windowManager;
    vi.spyOn(wm.decorationManager, "updateBorderLayout").mockImplementation(() => {});
    vi.spyOn(wm.decorationManager, "updateDecorationLayout").mockImplementation(() => {});
    wm.updateMetaPositionSize(metaWindow, "size-changed");
  }

  it("off: a kept maximize survives its next size change", () => {
    setup({ "auto-unmaximize-for-tiling": false });
    const { metaWindow } = maximizedTile();
    const node = openWindow();
    ctx.display.get_focus_window.mockReturnValue(node.nodeValue);
    sizeChanged(metaWindow);
    expect(metaWindow.is_maximized()).toBe(true);
  });

  it("on: a maximize beside a tiled window is rejected at its size change (Bug #461)", () => {
    setup({ "auto-unmaximize-for-tiling": true });
    const { metaWindow } = maximizedTile();
    metaWindow.unmaximize();
    const node = openWindow();
    metaWindow.maximize();
    ctx.display.get_focus_window.mockReturnValue(node.nodeValue);
    sizeChanged(metaWindow);
    expect(metaWindow.get_maximized()).toBe(0);
  });

  it("off: a one-axis snap beside a tiled window is rejected at its size change (Bug #461)", () => {
    setup({ "auto-unmaximize-for-tiling": false });
    const { metaWindow } = maximizedTile();
    metaWindow.unmaximize();
    const node = openWindow();
    metaWindow.maximize(MaximizeFlags.VERTICAL);
    ctx.display.get_focus_window.mockReturnValue(node.nodeValue);
    sizeChanged(metaWindow);
    expect(metaWindow.get_maximized()).toBe(0);
  });

  it("off: a lone one-axis snap is re-tiled once a new window tiles", () => {
    setup({ "auto-unmaximize-for-tiling": false });
    const { metaWindow } = maximizedTile();
    metaWindow.unmaximize();
    metaWindow.maximize(MaximizeFlags.VERTICAL);
    openWindow();
    expect(metaWindow.get_maximized()).toBe(0);
  });

  it("off: a keyboard resize of a kept maximize re-tiles it and keeps the split", () => {
    setup({ "auto-unmaximize-for-tiling": false });
    const { metaWindow, nodeWindow } = maximizedTile();
    const node = openWindow();
    metaWindow.move_resize_frame(false, 0, 0, 1920, 1080);
    const percents = [nodeWindow.percent, node.percent];
    ctx.display.get_focus_window.mockReturnValue(metaWindow);
    ctx.windowManager.resize(GrabOp.KEYBOARD_RESIZING_E, 10);
    sizeChanged(metaWindow);
    expect(metaWindow.get_maximized()).toBe(0);
    expect([nodeWindow.percent, node.percent]).toEqual(percents);
  });

  it.each(["WindowExpand", "WindowShrink"])(
    "off: %s of a kept maximize re-tiles it and keeps the split",
    (name) => {
      setup({ "auto-unmaximize-for-tiling": false });
      const { metaWindow, nodeWindow } = maximizedTile();
      const node = openWindow();
      const percents = [nodeWindow.percent, node.percent];
      ctx.display.get_focus_window.mockReturnValue(metaWindow);
      ctx.windowManager.command({ name, amount: 50 });
      expect(metaWindow.get_maximized()).toBe(0);
      expect([nodeWindow.percent, node.percent]).toEqual(percents);
    }
  );

  it("on: a Move that reparents a lone maximized tile keeps its maximize", () => {
    setup({ "auto-unmaximize-for-tiling": true });
    const { metaWindow, nodeWindow } = maximizedTile();
    const monitor = nodeWindow.parentNode;
    const con = createContainerNode(monitor, LAYOUT_TYPES.HSPLIT);
    con.appendChild(nodeWindow);
    ctx.tree.createNode(
      con.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ id: "f", window_type: WindowType.DIALOG })
    ).mode = WINDOW_MODES.FLOAT;
    ctx.display.get_focus_window.mockReturnValue(metaWindow);
    ctx.windowManager.command({ name: "Move", direction: "down" });
    expect(nodeWindow.parentNode).toBe(monitor);
    expect(metaWindow.is_maximized()).toBe(true);
  });

  // forge-z9ky: trackWindow reads a dead sibling in insertChildPercent; render prunes it.
  it.each([
    [true, false],
    [false, true],
  ])("a finalized tiled sibling: on=%s keeps=%s, the new window tiles", (on, keeps) => {
    setup({ "auto-unmaximize-for-tiling": on });
    const { metaWindow } = maximizedTile();
    const { metaWindow: dead } = createTiledWindow(ctx, {
      id: "dead",
      workspace: ctx.workspaces[0],
      monitor: 0,
    });
    finalizeWindow(dead);
    const node = openWindow();
    expect(node.mode).toBe(WINDOW_MODES.TILE);
    expect(metaWindow.is_maximized()).toBe(keeps);
  });

  it.each(["Move", "Swap"])("off: the %s command unmaximizes a kept window", (name) => {
    setup({ "auto-unmaximize-for-tiling": false });
    const { metaWindow } = maximizedTile();
    openWindow();
    expect(metaWindow.is_maximized()).toBe(true);
    ctx.display.get_focus_window.mockReturnValue(metaWindow);
    ctx.windowManager.command({ name, direction: name === "Move" ? "down" : "right" });
    expect(metaWindow.get_maximized()).toBe(0);
  });
});
