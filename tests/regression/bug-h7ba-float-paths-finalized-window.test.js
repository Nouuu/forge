import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  finalizeWindow,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-h7ba: two float paths dereferenced a possibly-finalized Meta.Window
 * with no isWindowAlive() probe:
 *  - cleanupAlwaysFloat/restoreAlwaysFloat iterate allNodeWindows calling
 *    is_above()/make_above()/unmake_above() on nodeValue, and
 *  - windowDestroy -> removeFloatOverride -> _updateWindowOverrides calls
 *    get_wm_class()/get_id().
 * On a fast/Wayland close the wrapper finalizes first, so the accessor throws
 * "already deallocated", aborting the loop / the rest of windowDestroy.
 *
 * Fix: gate all three with Utils.isWindowAlive (shared _forEachFloatNode helper
 * for the two float loops).
 */
describe("Bug forge-h7ba: float paths skip finalized windows", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  const addFloat = (overrides) => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const mw = createMockWindow({ allows_resize: true, ...overrides });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, mw);
    node.mode = WINDOW_MODES.FLOAT;
    return mw;
  };

  it("cleanupAlwaysFloat skips a finalized float and still unpins the live one", () => {
    // Dead is created first so it is visited before the live window: before the
    // fix its throw aborts the loop and the live window is never unpinned.
    const dead = addFloat({ id: 8001 });
    finalizeWindow(dead);

    const live = addFloat({ id: 8002 });
    live.make_above(); // is_above() === true

    let liveUnmade = false;
    const realUnmake = live.unmake_above.bind(live);
    live.unmake_above = () => {
      liveUnmade = true;
      realUnmake();
    };

    expect(() => ctx.windowManager.cleanupAlwaysFloat()).not.toThrow();
    expect(liveUnmade).toBe(true);
  });

  it("restoreAlwaysFloat skips a finalized float and still pins the live one", () => {
    const dead = addFloat({ id: 8003 });
    finalizeWindow(dead);

    const live = addFloat({ id: 8004 }); // is_above() === false by default

    let livePinned = false;
    const realMake = live.make_above.bind(live);
    live.make_above = () => {
      livePinned = true;
      realMake();
    };

    expect(() => ctx.windowManager.restoreAlwaysFloat()).not.toThrow();
    expect(livePinned).toBe(true);
  });

  // G13: _restoreAllDemotedFloats is the third loop of the same family and was
  // left behind by the forge-h7ba / forge-olv3 hardening — it gates only on a bare
  // `metaWindow &&`, and a finalized GObject wrapper is still truthy. It runs from
  // disable(), from the setting-off early return of the reconcile, and transitively
  // from windowDestroy, so a throw aborts teardown mid-way.
  it("_restoreAllDemotedFloats skips a finalized float and still re-pins the live one", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const demote = (mw) => {
      const node = ctx.tree.findNode(mw);
      mw._forgeSetAbove = true;
      mw._aboveDemotedForFullscreen = true;
      return node;
    };

    const dead = createMockWindow({ allows_resize: true, id: 8006 });
    const deadNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dead);
    deadNode.mode = WINDOW_MODES.FLOAT;
    dead._forgeSetAbove = true;
    dead._aboveDemotedForFullscreen = true;
    finalizeWindow(dead);

    const live = addFloat({ id: 8007 }); // is_above() === false by default
    demote(live);

    let livePinned = false;
    const realMake = live.make_above.bind(live);
    live.make_above = () => {
      livePinned = true;
      realMake();
    };

    expect(() => ctx.windowManager._restoreAllDemotedFloats()).not.toThrow();
    expect(livePinned).toBe(true);
  });

  it("removeFloatOverride does not throw on a finalized window", () => {
    const dead = createMockWindow({ id: 8005 });
    finalizeWindow(dead);

    expect(() => ctx.windowManager.removeFloatOverride(dead, true)).not.toThrow();
  });
});
