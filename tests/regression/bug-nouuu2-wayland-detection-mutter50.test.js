import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Nouuu/forge#2: Wayland-only fixes are off on GNOME 50+.
 *
 * Root cause: Mutter 50 dropped the X11 backend and meta_is_wayland_compositor with it.
 * The three guards `Meta.is_wayland_compositor && Meta.is_wayland_compositor()` became
 * false on 50+, silently disabling the buffer-scale alignment in move() (Bug #224), the
 * border alignment (Bug #164) and the stacking pin above the desktop layer (Bug #416).
 *
 * Fix: Compat.isWaylandCompositor() returns true from Mutter 50 (IS_MUTTER_50_PLUS) and
 * asks Meta before that; the three call sites use it.
 */
async function loadWm(packageVersion) {
  vi.resetModules();
  vi.doMock("resource:///org/gnome/shell/misc/config.js", () => ({
    PACKAGE_VERSION: packageVersion,
  }));
  const helpers = await import("../mocks/helpers/index.js");
  const { NODE_TYPES } = await import("../../lib/extension/tree.js");
  const { WINDOW_MODES } = await import("../../lib/extension/window.js");
  // gi:// resolves to the shared mocks from tests/setup.js, the instances lib/ uses.
  const Meta = await import("gi://Meta");
  const St = await import("gi://St");
  const ctx = helpers.createWindowManagerFixture();
  const { monitor } = helpers.getWorkspaceAndMonitor(ctx);
  const meta = helpers.createMockWindow({
    workspace: ctx.workspaces[0],
    rect: new Meta.Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
  });
  const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta);
  node.mode = WINDOW_MODES.TILE;
  St.__setScaleFactor(2);
  return { wm: ctx.windowManager, meta, Meta, St };
}

describe("Nouuu/forge#2: Wayland detection on Mutter 50+", () => {
  let St, Meta, realIsWayland;

  afterEach(() => {
    St?.__setScaleFactor(1);
    if (Meta && realIsWayland) Meta.default.is_wayland_compositor = realIsWayland;
    Meta?.__setWayland(false);
    vi.doUnmock("resource:///org/gnome/shell/misc/config.js");
  });

  const odd = { x: 101, y: 51, width: 959, height: 539 };

  it("aligns move() to the buffer scale on GNOME 50, where is_wayland_compositor is gone", async () => {
    let wm, meta;
    ({ wm, meta, Meta, St } = await loadWm("50.0"));
    realIsWayland = Meta.default.is_wayland_compositor;
    Meta.default.is_wayland_compositor = undefined;
    const moveResize = vi.spyOn(meta, "move_resize_frame");

    wm.move(meta, odd);

    const a = (v) => wm._alignToBufferScale(v, 2);
    expect(moveResize).toHaveBeenCalledWith(true, a(odd.x), a(odd.y), a(odd.width), a(odd.height));
  });

  it("leaves an X11 session on GNOME 49 unaligned", async () => {
    let wm, meta;
    ({ wm, meta, Meta, St } = await loadWm("49.0"));
    Meta.__setWayland(false);
    const moveResize = vi.spyOn(meta, "move_resize_frame");

    wm.move(meta, odd);

    expect(moveResize).toHaveBeenCalledWith(true, odd.x, odd.y, odd.width, odd.height);
  });
});
