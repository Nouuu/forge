import { describe, it, expect, beforeEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Bug #530 regression: move() called windowActor.remove_all_transitions()
 * unconditionally. Forge itself never adds window-actor transitions, so the
 * only effect on a freshly created window was to strip the map/open effect
 * (GNOME Shell's own or an animation extension's like Burn My Windows) when
 * the first tiling placement landed. The first placement of a new window
 * (metaWindow.firstRender, set in trackWindow) must leave transitions alone.
 */
describe("Bug #530: first placement preserves the window-open animation", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;
  const rect = { x: 0, y: 0, width: 960, height: 1080 };

  function newTrackedWindow() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const meta = createMockWindow({
      rect: new Rectangle(rect),
      workspace: ctx.workspaces[0],
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta);
    node.mode = WINDOW_MODES.TILE;
    return { meta, node };
  }

  // Note (forge-wsc #351): move() now skips entirely when the window already
  // sits at the target rect, so these tests move to a rect that DIFFERS from
  // the current frame - the #530 contract is "a real first placement keeps
  // transitions; later real moves strip them". No-op moves never strip
  // (covered by bug-351-noop-move-flicker.test.js).
  const otherRect = { x: 960, y: 0, width: 960, height: 1080 };

  it("first move of a freshly created window preserves actor transitions", () => {
    const { meta } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    meta.firstRender = true;
    wm().move(meta, otherRect);

    expect(spy).not.toHaveBeenCalled();
    expect(meta.get_frame_rect().x).toBe(otherRect.x);
  });

  it("subsequent moves strip transitions as before", () => {
    const { meta } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    wm().move(meta, otherRect);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the skip is one-shot even when the window is never tiled by render", () => {
    // A permanently floating window never goes through tree.apply(), which is
    // where firstRender is otherwise cleared - move() must consume the flag
    // itself so only the FIRST placement skips the strip.
    const { meta } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    meta.firstRender = true;
    wm().move(meta, otherRect);
    wm().move(meta, rect);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  // G015: Tree.apply cleared firstRender for every tiled child, including one whose
  // move() early-returned. move() is the only reader, so a window that never got
  // placed lost its one-shot and had its open effect stripped on the next render —
  // exactly what #530 exists to prevent. move() is now the sole authority.
  it("keeps the one-shot when move() early-returns under a live grab", () => {
    const { meta, node } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    meta.firstRender = true;
    // A live Forge grab makes move() return before it consumes the flag.
    node.grabMode = true;
    ctx.tree.render("test-grabbed");
    expect(spy).not.toHaveBeenCalled();
    expect(meta.firstRender).toBe(true);

    // Grab over: the deferred first placement must still keep the open effect.
    node.grabMode = null;
    meta.move_resize_frame(false, 5, 5, 300, 300);
    ctx.tree.render("test-after-grab");

    expect(spy).not.toHaveBeenCalled();
  });

  // Found by the per-window bookkeeping fuzzer. tree.reload() empties the tree, so
  // trackCurrentWindows re-enters trackWindow with existNodeWindow null for EVERY
  // live window and re-armed the one-shot. #530 is about a genuinely new window;
  // handing the flag back to windows that are not new means the first placement
  // after any reload skips remove_all_transitions() and leaves an in-flight shell
  // effect running while Forge repositions the window. Reloads are not rare — enable,
  // workspaces-reordered, the no-meta-monws fallback, and now monitor hot-plug.
  it("does not re-arm the one-shot when a reload re-tracks a live window", () => {
    const { meta } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    meta.firstRender = true;
    wm().move(meta, otherRect);
    expect(meta.firstRender).toBe(false);
    expect(spy).not.toHaveBeenCalled();

    // What reloadTree does: wipe the tree, then re-track the same Meta.Windows.
    // renderTree is stubbed so this asserts what trackWindow itself does with the
    // flag — whether the trailing render happens to consume it again depends on
    // whether the window lands on a different rect, which is not a contract.
    const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    global.display.get_tab_list.mockReturnValue([meta]);
    ctx.tree.reload();
    wm().trackCurrentWindows();
    renderSpy.mockRestore();

    expect(meta.firstRender).toBe(false);

    // So the next placement still cancels in-flight effects.
    meta.move_resize_frame(false, 5, 5, 300, 300);
    wm().move(meta, rect);
    expect(spy).toHaveBeenCalled();
  });

  it("render path: first render preserves transitions, a real re-placement strips", () => {
    const { meta } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    meta.firstRender = true;
    ctx.tree.render("test-first");
    expect(spy).not.toHaveBeenCalled();

    // Drift the frame (e.g. an external move) so the next render re-places it.
    meta.move_resize_frame(false, 5, 5, 300, 300);
    ctx.tree.render("test-second");
    expect(spy).toHaveBeenCalled();
  });
});
