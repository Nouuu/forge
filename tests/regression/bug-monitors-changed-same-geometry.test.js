import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../mocks/helpers/index.js";

/**
 * Bug monitors-changed-same-geometry (2026-09-14/15, journal on a live session):
 * every suspend/resume, lock/unlock, DPMS cycle and spurious DRM hotplug (a
 * privileged Docker container starting on the host) lost the user's arrangement —
 * split percents reset to equal shares, children re-ordered by stacking order,
 * monitor layouts back to the geometry default. No monitor had been plugged or
 * unplugged.
 *
 * Root cause: `_onMonitorsChanged` answered every `Main.layoutManager::monitors-changed`
 * with `reloadTree("monitors-changed")`, which empties the tree and re-tracks every
 * window flat. Mutter emits that signal for events that leave the monitor set
 * untouched, so the full reload — correct for a real hot-plug — ran several times a
 * day for nothing.
 *
 * Fix: `reloadTree` records the monitor set (primary index + per-index geometry) as
 * one string key when it completes; `_onMonitorsChanged` reloads only when the live
 * key differs and otherwise just renders. A zero-monitor report is still ignored and a
 * `null` geometry (forge-fhen10 mid-transition) compares as changed, so both keep
 * today's behaviour.
 */
describe("Bug monitors-changed-same-geometry: unchanged monitor set keeps the tree", () => {
  let ctx, tree, display, reloadSpy, renderSpy;
  const realIdleAdd = GLib.idle_add;
  let pending;

  // The default GLib mock runs idle_add synchronously. Defer and flush by hand, like
  // real GJS, so the debounce sees a pending reload (same recipe as
  // bug-531-rendertree-wedge).
  function flush() {
    while (pending.length) pending.shift()();
  }

  // Two monitors side by side, primary 0 — the default fixture shape.
  const twoMonitors = () =>
    createWindowManagerFixture({
      globals: { display: { monitorCount: 2 }, workspaceManager: { workspaceCount: 1 } },
    });

  /** Tile two windows 70/30 on monitor 0 and return their nodes in child order. */
  function tileTwo() {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = createWindowNode(tree, monitor, { windowOverrides: { id: "a" } }).nodeWindow;
    const b = createWindowNode(tree, monitor, { windowOverrides: { id: "b" } }).nodeWindow;
    a.percent = 0.7;
    b.percent = 0.3;
    return [a, b];
  }

  beforeEach(() => {
    pending = [];
    GLib.idle_add = (priority, cb) => {
      pending.push(cb);
      return pending.length;
    };
    ctx = twoMonitors();
    tree = ctx.tree;
    display = ctx.display;
    // Prime the snapshot the way enable() does.
    ctx.windowManager.reloadTree("prime");
    flush();
    reloadSpy = vi.spyOn(ctx.windowManager, "reloadTree");
    renderSpy = vi.spyOn(ctx.windowManager, "renderTree");
  });

  afterEach(() => {
    GLib.idle_add = realIdleAdd;
    ctx.cleanup();
  });

  it("same count, geometries and primary: renders once, reloads nothing, keeps every node", () => {
    const [a, b] = tileTwo();
    const parent = a.parentNode;

    ctx.windowManager._onMonitorsChanged();
    flush();

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledWith("monitors-changed");
    const windows = tree.getNodeByType(NODE_TYPES.WINDOW);
    expect(windows[0]).toBe(a);
    expect(windows[1]).toBe(b);
    expect(parent.childNodes.map((n) => n.percent)).toEqual([0.7, 0.3]);
  });

  it("monitor count differs: reloads, and the replaced snapshot makes the next identical signal an equal one", () => {
    display.get_n_monitors.mockReturnValue(1);

    ctx.windowManager._onMonitorsChanged();
    flush();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledWith("monitors-changed");

    // The reload above captured the 1-monitor set and rendered once; the same set
    // again is "equal" and renders a second time without reloading.
    ctx.windowManager._onMonitorsChanged();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it("one geometry differs: reloads", () => {
    const original = display.get_monitor_geometry.getMockImplementation();
    display.get_monitor_geometry.mockImplementation((i) =>
      i === 1 ? { x: 1920, y: 0, width: 2560, height: 1440 } : original(i)
    );

    ctx.windowManager._onMonitorsChanged();

    expect(reloadSpy).toHaveBeenCalledWith("monitors-changed");
  });

  it("primary index differs with identical geometries: reloads", () => {
    display.get_primary_monitor.mockReturnValue(1);

    ctx.windowManager._onMonitorsChanged();

    expect(reloadSpy).toHaveBeenCalledWith("monitors-changed");
  });

  it("zero monitors: ignored, snapshot untouched", () => {
    display.get_n_monitors.mockReturnValue(0);
    ctx.windowManager._onMonitorsChanged();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();

    // Monitors come back unchanged: the pre-signal snapshot still matches.
    display.get_n_monitors.mockReturnValue(2);
    ctx.windowManager._onMonitorsChanged();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it("a null geometry for a counted index: reloads (FR-004)", () => {
    const original = display.get_monitor_geometry.getMockImplementation();
    display.get_monitor_geometry.mockImplementation((i) => (i === 1 ? null : original(i)));

    ctx.windowManager._onMonitorsChanged();

    expect(reloadSpy).toHaveBeenCalledWith("monitors-changed");
  });
});
