import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Rectangle, WindowType } from "../../mocks/gnome/Meta.js";
import Clutter from "gi://Clutter";
import { mockSeat } from "../../mocks/gnome/Clutter.js";

/**
 * WindowManager focus-follows-pointer tests
 *
 * Tests for pointer-related behaviors including:
 * - movePointerWith(): Warp pointer to focused window
 * - _focusWindowUnderPointer(): Focus window under pointer
 * - Focus disabled during overview
 * - Focus disabled during workspace transitions
 * - Dialog/modal focus protection
 */
describe("WindowManager - Focus-Follows-Pointer Behavior", () => {
  let ctx;

  beforeEach(() => {
    mockSeat.warp_pointer.mockClear();
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  describe("movePointerWith", () => {
    it("should return early when nodeWindow is null", () => {
      expect(() => wm().movePointerWith(null)).not.toThrow();
    });

    it("should return early when nodeWindow has no _data", () => {
      expect(() => wm().movePointerWith({})).not.toThrow();
    });

    it("should not warp pointer when move-pointer-focus-enabled is false", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "move-pointer-focus-enabled") return false;
        return true;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const warpSpy = vi.spyOn(wm(), "warpPointerToNodeWindow");

      wm().movePointerWith(nodeWindow);

      expect(warpSpy).not.toHaveBeenCalled();
    });

    it("should warp pointer when move-pointer-focus-enabled is true", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "move-pointer-focus-enabled") return true;
        return true;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const canMoveSpy = vi.spyOn(wm(), "canMovePointerInsideNodeWindow");

      wm().movePointerWith(nodeWindow);

      expect(canMoveSpy).toHaveBeenCalledWith(nodeWindow);
    });

    it("should warp pointer when force option is true", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "move-pointer-focus-enabled") return false;
        return true;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const canMoveSpy = vi.spyOn(wm(), "canMovePointerInsideNodeWindow");

      wm().movePointerWith(nodeWindow, { force: true });

      expect(canMoveSpy).toHaveBeenCalledWith(nodeWindow);
    });

    it("should update lastFocusedWindow", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      wm().movePointerWith(nodeWindow);

      expect(wm().lastFocusedWindow).toBe(nodeWindow);
    });
  });

  // The seat lookup is the one Clutter API Forge calls that is NOT routed through
  // compat.js, and the setting that reaches it (move-pointer-focus-enabled) appears
  // nowhere in tests/e2e — so this path has never run against a real shell on any of
  // the six GNOME versions CI covers. It sits inside the focus handler, so a throw
  // here breaks focus on every window change, not just the pointer warp.
  describe("warpPointerToNodeWindow seat lookup", () => {
    const nodeUnderTest = () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      return ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    };

    it("warps through the seat when the backend provides one", () => {
      wm().warpPointerToNodeWindow(nodeUnderTest());

      expect(mockSeat.warp_pointer).toHaveBeenCalled();
    });

    it("does not throw when the backend accessor is unavailable", () => {
      // Mutter/Clutter introspection has moved this accessor before; if it is gone
      // on some supported version the focus path must degrade, not break.
      const real = Clutter.get_default_backend;
      Clutter.get_default_backend = undefined;
      try {
        expect(() => wm().warpPointerToNodeWindow(nodeUnderTest())).not.toThrow();
      } finally {
        Clutter.get_default_backend = real;
      }
    });

    it("prefers the Shell backend's seat when one is exposed", () => {
      // global.backend is GNOME Shell's own accessor; Clutter.get_default_backend()
      // is Clutter's. Both have been the current one at different points, so Forge
      // asks Shell first and falls back — this pins that order.
      const shellWarp = vi.fn();
      global.backend = { get_default_seat: () => ({ warp_pointer: shellWarp }) };
      try {
        wm().warpPointerToNodeWindow(nodeUnderTest());

        expect(shellWarp).toHaveBeenCalled();
        expect(mockSeat.warp_pointer).not.toHaveBeenCalled();
      } finally {
        delete global.backend;
      }
    });

    it("falls back to Clutter when the Shell backend exposes no seat", () => {
      global.backend = { get_default_seat: () => null };
      try {
        wm().warpPointerToNodeWindow(nodeUnderTest());

        expect(mockSeat.warp_pointer).toHaveBeenCalled();
      } finally {
        delete global.backend;
      }
    });

    it("does not throw when the backend accessor itself throws", () => {
      const real = Clutter.get_default_backend;
      Clutter.get_default_backend = () => {
        throw new Error("Clutter backend unavailable");
      };
      try {
        expect(() => wm().warpPointerToNodeWindow(nodeUnderTest())).not.toThrow();
      } finally {
        Clutter.get_default_backend = real;
      }
    });

    it("does not throw when the backend returns no seat", () => {
      const real = Clutter.get_default_backend;
      Clutter.get_default_backend = () => ({ get_default_seat: () => null });
      try {
        expect(() => wm().warpPointerToNodeWindow(nodeUnderTest())).not.toThrow();
        expect(mockSeat.warp_pointer).not.toHaveBeenCalled();
      } finally {
        Clutter.get_default_backend = real;
      }
    });

    it("does not throw when warp_pointer itself fails", () => {
      mockSeat.warp_pointer.mockImplementationOnce(() => {
        throw new Error("Object Clutter.Seat has been already deallocated");
      });

      expect(() => wm().warpPointerToNodeWindow(nodeUnderTest())).not.toThrow();
    });
  });

  describe("_focusWindowUnderPointer - Focus Behavior", () => {
    it("should focus window under pointer when conditions are met", () => {
      wm().shouldFocusOnHover = true;
      wm().disabled = false;
      global.Main.overview.visible = false;

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const windowActor = metaWindow.get_compositor_private();
      windowActor.meta_window = metaWindow;
      global.get_window_actors.mockReturnValue([windowActor]);

      // Pointer is inside window
      global.get_pointer.mockReturnValue([960, 540]);

      const focusSpy = vi.spyOn(metaWindow, "focus");
      const raiseSpy = vi.spyOn(metaWindow, "raise");

      wm()._focusWindowUnderPointer();

      expect(focusSpy).toHaveBeenCalledWith(expect.anything());
      expect(raiseSpy).toHaveBeenCalled();
    });

    it("should continue polling by returning true", () => {
      wm().shouldFocusOnHover = true;
      wm().disabled = false;

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(true);
    });

    it("should not focus when pointer is outside all windows", () => {
      wm().shouldFocusOnHover = true;
      wm().disabled = false;

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0(),
      });

      const windowActor = metaWindow.get_compositor_private();
      windowActor.meta_window = metaWindow;
      global.get_window_actors.mockReturnValue([windowActor]);

      // Pointer is outside window
      global.get_pointer.mockReturnValue([1500, 900]);

      const focusSpy = vi.spyOn(metaWindow, "focus");

      wm()._focusWindowUnderPointer();

      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe("focus-on-hover pointer loop", () => {
    it("starts the pointer loop when focus-on-hover-enabled is true at construction", () => {
      const fixture = createWindowManagerFixture({
        settings: { "focus-on-hover-enabled": true },
      });

      expect(fixture.windowManager.shouldFocusOnHover).toBe(true);
      // pointerLoopInit() runs in the constructor and registers a GLib timeout
      expect(fixture.windowManager._pointerFocusTimeoutId).toBeTruthy();
    });

    it("does not start the pointer loop when focus-on-hover-enabled is false", () => {
      const fixture = createWindowManagerFixture({
        settings: { "focus-on-hover-enabled": false },
      });

      expect(fixture.windowManager.shouldFocusOnHover).toBe(false);
      expect(fixture.windowManager._pointerFocusTimeoutId).toBeFalsy();
    });
  });
});
