import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug empty-title-float-stuck (2026-09-14, journal 15:55:09): a window mapped with an
 * empty title (JetBrains IDEs, some terminals) "appears floating until moved", and
 * dragging it shows no tile preview while dragging its sibling does.
 *
 * Root cause: isFloatingExempt() floats a window whose title is empty (floatByRole),
 * and processFloats() only re-evaluates on a render. Forge listens for a late
 * wm_class (notify::wm-class → renderTree, Bug #482) but not for a late title, so
 * once the app sets its real title nothing re-renders: the node stays FLOAT until an
 * unrelated event (the user's drag ends in grab-op-end) triggers processFloats.
 *
 * Fix: connect notify::title in _bindWindowSignals and re-render when the node is
 * FLOAT but no longer exempt — the one case a title change can flip.
 */
describe("Bug empty-title-float-stuck: a late title re-tiles the window", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  function track(title) {
    const win = createMockWindow({
      wm_class: "jetbrains-goland",
      id: 3001,
      title,
      allows_resize: true,
    });
    ctx.windowManager.trackWindow(null, win);
    return win;
  }

  it("floats a window while its title is empty", () => {
    const win = track("");
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(true);
    ctx.windowManager.processFloats();
    expect(ctx.tree.findNode(win).isFloat()).toBe(true);
  });

  it("re-renders when the title lands on a stale float", () => {
    const win = track("");
    ctx.windowManager.processFloats();
    const node = ctx.tree.findNode(win);
    expect(node.isFloat()).toBe(true);

    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree");
    win.set_title("sbs-api – .golangci.yml");

    expect(renderSpy).toHaveBeenCalledWith("title-changed");
    ctx.windowManager.processFloats();
    expect(node.isTile()).toBe(true);
  });

  it("does not re-render for a title change on a tiled window", () => {
    const win = track("Terminal");
    ctx.windowManager.processFloats();
    expect(ctx.tree.findNode(win).isTile()).toBe(true);

    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree");
    win.set_title("nospy@host: ~/src");

    expect(renderSpy).not.toHaveBeenCalledWith("title-changed");
  });

  it("does not re-render for a title change on a window the user floated", () => {
    const win = track("Terminal");
    const node = ctx.tree.findNode(win);
    ctx.windowManager.processFloats();
    // A user float is a per-window override, so the window stays floating-exempt.
    ctx.windowManager.addFloatOverride(win, true);
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);

    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree");
    win.set_title("nospy@host: ~/src");

    expect(renderSpy).not.toHaveBeenCalledWith("title-changed");
  });
});
