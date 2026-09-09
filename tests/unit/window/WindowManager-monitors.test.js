import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import { createWindowManagerFixture } from "../../mocks/helpers/index.js";
import { withSignals } from "../../mocks/helpers/signalMixin.js";

/**
 * Monitor hot-plug wiring (workspaces-monitors G3/G4).
 *
 * Nothing in the extension reacted to a monitor being plugged in or unplugged.
 * `MonitorManager.addMonitor` had a single caller chain — `addWorkspace` ->
 * `tree.addMonitor` — and `addWorkspace` returns false as soon as the `ws{n}` node
 * exists, so it never ran again for a live workspace. There was no `removeMonitor`
 * at all. The tree's `mo{m}ws{n}` scaffold therefore went stale until an unrelated
 * full reload, and the only one that happened in practice was incidental: a new
 * window whose monitor node was missing fired `reloadTree("no-meta-monws")`.
 *
 * Symptoms: a window MOVED to a freshly plugged monitor was never re-homed
 * (`updateMetaWorkspaceMonitor` needs `metaMonWsNode`, which did not exist), so the
 * next render dragged it back to its old monitor; and an unplugged monitor left its
 * nodes and their St.Bins parented in window_group.
 *
 * Fix: connect Main.layoutManager::monitors-changed and reload the tree. reloadTree
 * already rebuilds the scaffold at the live monitor count, tears down the old bins
 * (Tree._removeScaffoldBins) and preserves stacked/tabbed groupings (forge-bqa), so
 * this needs no new sync or teardown logic of its own.
 */
describe("monitor hot-plug", () => {
  let ctx;

  beforeEach(() => {
    Main.layoutManager._reset();
  });

  afterEach(() => ctx?.cleanup());

  const monitorNodes = () => ctx.tree.getNodeByType(NODE_TYPES.MONITOR);

  it("adds the monitor nodes for a newly plugged monitor", () => {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 1 }, workspaceManager: { workspaceCount: 2 } },
    });
    expect(ctx.tree.findNode("mo1ws0")).toBeNull();

    // The second monitor arrives, then Mutter emits the signal.
    global.display.get_n_monitors.mockReturnValue(2);
    // The GLib mock runs idle_add callbacks synchronously, so reloadTree lands here.
    ctx.windowManager._onMonitorsChanged();

    expect(ctx.tree.findNode("mo1ws0")).not.toBeNull();
    expect(ctx.tree.findNode("mo1ws1")).not.toBeNull();
  });

  it("drops the monitor nodes and their bins when a monitor is unplugged", () => {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 2 }, workspaceManager: { workspaceCount: 2 } },
    });
    const staleBins = monitorNodes()
      .filter((n) => n.nodeValue.startsWith("mo1"))
      .map((n) => n.actorBin);
    expect(staleBins.length).toBe(2);

    global.display.get_n_monitors.mockReturnValue(1);
    // The GLib mock runs idle_add callbacks synchronously, so reloadTree lands here.
    ctx.windowManager._onMonitorsChanged();

    expect(ctx.tree.findNode("mo1ws0")).toBeNull();
    for (const bin of staleBins) {
      expect(global.window_group.contains(bin)).toBe(false);
    }
  });

  // The KVM-switch / lock / DPMS case: Mutter transiently reports zero monitors.
  // Reloading there would wipe the tree and strand every tracked window, which is
  // exactly what _onWorkareasChanged's own monitor-count guard exists to prevent.
  it("ignores the signal while no monitor is connected", () => {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 1 }, workspaceManager: { workspaceCount: 1 } },
    });
    const reloadSpy = vi.spyOn(ctx.windowManager, "reloadTree");

    global.display.get_n_monitors.mockReturnValue(0);
    ctx.windowManager._onMonitorsChanged();

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  // Wiring, separate from behaviour: the handler above is only reached if it is
  // actually connected, and an unconnected disconnect is the classic extension leak
  // the repo's no-untracked-connect rule exists to prevent.
  it("connects on _bindSignals and disconnects on _removeSignals", () => {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 1 }, workspaceManager: { workspaceCount: 1 } },
    });
    const wm = ctx.windowManager;
    // The fixture's settings mock has no signal system; graft the shared mixin on
    // so _bindSignals/_removeSignals can connect and disconnect it (same shape as
    // bug-5y6j-settings-signal-disconnect).
    const SignalBox = withSignals();
    ctx.extension.settings = Object.assign(new SignalBox(), ctx.extension.settings);

    wm._bindSignals();
    const connected = [...Main.layoutManager._handlers.values()];
    expect(connected.map((h) => h.signal)).toContain("monitors-changed");

    // The connected handler is the real one.
    const reloadSpy = vi.spyOn(wm, "reloadTree").mockImplementation(() => {});
    Main.layoutManager.emit("monitors-changed");
    expect(reloadSpy).toHaveBeenCalledWith("monitors-changed");

    wm._removeSignals();

    expect(Main.layoutManager._handlers.size).toBe(0);
  });
});
