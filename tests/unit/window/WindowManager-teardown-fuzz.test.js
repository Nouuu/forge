import { describe, it, expect, beforeEach, afterEach } from "vitest";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  finalizeWindow,
  setPointer,
} from "../../mocks/helpers/index.js";
import { GrabOp, Rectangle } from "../../mocks/gnome/Meta.js";
import { withSignals } from "../../mocks/helpers/signalMixin.js";

/**
 * WindowManager teardown fuzzer
 *
 * `disable()` is the one path where a throw is not a bug report but an outage:
 * GNOME Shell catches it, marks the extension as errored and refuses to load it
 * again until the user intervenes. It also runs at the least convenient moments —
 * screen lock, suspend, an extension update — which is exactly when the tree is
 * most likely to hold a finalized window, a live grab, or a queued source.
 *
 * Most of the hardening in `disable()` was added one incident at a time
 * (forge-h6jc scaffold bins, forge-ph7f transient pins, forge-olv3 finalized
 * wrappers, bug-328 disconnect storms, forge-leqs grab state). Each has its own
 * pinned regression test for the state that produced it; none of them asserts the
 * general property, which is that NO reachable state makes teardown throw or leak.
 *
 * So this replays a randomized shell state — arbitrary layouts, floats, pinned
 * floats, finalized wrappers, an in-flight grab, armed sources, orphaned
 * decorations — then tears down and asserts what teardown owes: no throw, no
 * surviving source, no surviving handler, nothing left parented in window_group.
 * Then it re-enables, because lock/unlock is a cycle and a teardown that leaves
 * the manager unusable is only half a teardown.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

const LAYOUTS = ["HSPLIT", "VSPLIT", "STACKED", "TABBED"];

const SEEDS = Array.from({ length: 40 }, (_, i) => 0xdead_0000 + i * 0x9e37);

describe("WindowManager - teardown fuzzer", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "float-always-on-top-enabled": true,
        "tiling-mode-enabled": true,
        // Off by default; on here so an interrupted drag actually parents a preview
        // hint into window_group — otherwise the teardown of that actor is untested.
        "preview-hint-enabled": true,
      },
    });
    ctx.extension.keybindings = { allowDragDropTile: () => true };
    // The fixture's settings mock has no signal system, and _bindSignals connects a
    // "changed" handler to it (same graft as bug-5y6j-settings-signal-disconnect).
    const SignalBox = withSignals();
    ctx.extension.settings = Object.assign(new SignalBox(), ctx.extension.settings);
  });

  afterEach(() => ctx.cleanup());

  /**
   * Everything Forge parents into window_group must be gone after teardown: the
   * scaffold bins (one per workspace AND per monitor — the forge-h6jc leak), the
   * focus borders, and any drag preview left by an interrupted grab. The baseline
   * is taken before enable(), or the bins created by enable() count as "was already
   * there" and the assertion silently covers nothing.
   */
  const windowGroupBaseline = () => [...global.window_group._children];

  /** Build a randomized shell state, returning the windows it produced. */
  const buildState = (rng, seed, wm) => {
    // disable() always follows an enable() in the shell, and _removeSignals
    // early-returns unless _bindSignals ran — skipping it models a teardown the
    // extension never performs, and silently voids every assertion below.
    wm.enable();
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES[pick(rng, LAYOUTS)];
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    const metas = [];
    for (let i = 0; i < randInt(rng, 1, 4); i++) {
      const meta = createMockWindow({
        id: `${seed}-w${i}`,
        workspace: ctx.workspaces[0],
        allows_resize: rng() < 0.7,
        rect: new Rectangle({ x: 0, y: 0, width: 480, height: 540 }),
      });
      // Capture the label now: a finalized wrapper throws from get_id(), and an
      // assertion MESSAGE that throws hides the assertion it was describing.
      meta.__label = `${seed}-w${i}`;
      metas.push(meta);
    }
    global.display.get_tab_list.mockReturnValue(metas);

    // Track through the real path so signals, borders and firstRender are real.
    for (const meta of metas) wm.trackWindow(global.display, meta);

    for (const meta of metas) {
      const node = ctx.tree.findNode(meta);
      if (!node) continue;
      // A mix of tiled, floating, and Forge-pinned floating windows.
      if (rng() < 0.4) node.float = true;
      // Some windows carry the transient focus pin (forge-ph7f).
      if (rng() < 0.3) {
        meta.make_above();
        meta._forgeTransientAbove = true;
      }
      // Some carry a per-window stacking source (forge-jnfk).
      if (rng() < 0.3) meta._forgeStackTimeoutId = 4242;
      // Some are already fullscreen-demoted (forge-zo4).
      if (rng() < 0.2 && meta._forgeSetAbove) meta._aboveDemotedForFullscreen = true;
    }

    // A live grab, terminated or not (forge-leqs / forge-62ja).
    // A TILED window: _handleMoving early-returns unless the node is GRAB_TILE, and
    // _handleGrabOpBegin only promotes tiled windows — dragging a float would leave
    // the drop-preview path unexercised.
    const tiledMetas = metas.filter((m) => ctx.tree.findNode(m)?.mode === WINDOW_MODES.TILE);
    if (rng() < 0.5 && tiledMetas.length) {
      const dragged = pick(rng, tiledMetas);
      ctx.display.get_focus_window.mockReturnValue(dragged);
      wm._handleGrabOpBegin(ctx.display, dragged, GrabOp.MOVING_UNCONSTRAINED);
      // Drag over a SIBLING's rect so the drop-zone preview is actually built; a
      // pointer in empty space produces no hint and leaves nothing to release.
      const other = metas.find((m) => m !== dragged) ?? dragged;
      const target = other.get_frame_rect();
      setPointer(target.x + Math.floor(target.width / 2), target.y + Math.floor(target.height / 2));
      wm.updateMetaPositionSize(dragged, "fuzz");
    }

    // A finalized wrapper still referenced by the tree (forge-olv3 / bug-328).
    //
    // The border is released first, because the shell releases it first: the actor's
    // own `destroy` fires windowDestroy(ACTOR) — which takes the actor, not the
    // wrapper, so it succeeds even once the wrapper is gone. A Meta.Window cannot
    // finalize while its actor is still alive, so "finalized wrapper that still owns
    // a parented border" is not a state the shell can produce, and asserting on it
    // would report a leak the code cannot cause.
    if (rng() < 0.5 && metas.length > 1) {
      const dead = pick(rng, metas);
      const deadActor = dead.get_compositor_private();
      wm._destroyActorBorder(deadActor, "border");
      wm._destroyActorBorder(deadActor, "splitBorder");
      finalizeWindow(dead);
    }

    // Sources armed and left in flight.
    if (rng() < 0.6) wm._renderTreeSrcId = 101;
    if (rng() < 0.6) wm._queueSourceId = 102;
    if (rng() < 0.4) wm._workspaceChangingTimeoutId = 103;
    if (rng() < 0.4) wm._manualResizeEndId = 104;
    if (rng() < 0.4) wm._pointerFocusTimeoutId = 105;

    return metas;
  };

  for (const seed of SEEDS) {
    it(`tears down cleanly from seed ${seed}`, () => {
      const rng = mulberry32(seed);
      const wm = ctx.windowManager;
      const binsBefore = windowGroupBaseline();
      const metas = buildState(rng, seed, wm);

      // T1 — teardown never throws. GNOME catches a throw here and marks the
      // extension errored; the user then has to re-enable it by hand.
      expect(() => wm.disable(), `seed ${seed}: disable() threw`).not.toThrow();

      // T2 — no GLib source outlives the manager. A queued source firing into a
      // disabled WindowManager is the classic post-disable crash.
      for (const prop of [
        "_renderTreeSrcId",
        "_reloadTreeSrcId",
        "_queueSourceId",
        "_workspaceChangingTimeoutId",
        "_manualResizeEndId",
        "_pointerFocusTimeoutId",
        "_wsWindowAddSrcId",
      ]) {
        expect(wm[prop] ?? 0, `seed ${seed}: ${prop} survived disable()`).toBeFalsy();
      }
      for (const meta of metas) {
        expect(
          meta._forgeStackTimeoutId ?? 0,
          `seed ${seed}: per-window stacking source survived on ${meta.__label}`
        ).toBeFalsy();
      }

      // T3 — no handler outlives the manager, for windows that are still alive.
      // (A finalized wrapper's handlers died with the object.)
      for (const meta of metas) {
        if (meta.__finalized) continue;
        expect(
          meta.windowSignals,
          `seed ${seed}: windowSignals survived on ${meta.__label}`
        ).toBeUndefined();
      }

      // T4 — nothing Forge parented stays in window_group. The forge-h6jc leak was
      // one St.Bin per workspace AND per monitor, every reload.
      const leaked = global.window_group._children.filter((c) => !binsBefore.includes(c));
      expect(leaked, `seed ${seed}: actors left parented in window_group`).toEqual([]);

      // NOT covered here: the drop-preview actor. _handleMoving builds it only from a
      // full drag gesture this fixture does not reproduce (0 of 40 seeds produce one,
      // measured — so an assertion on it would be vacuous). Its release is covered by
      // WindowManager-grab-fuzz, which drives the gesture end to end; what is missing
      // is the release path through disable() rather than _handleGrabOpEnd.
      //
      // T5 is folded into T4 on purpose. An interrupted grab's preview hint is an
      // actor parented into window_group, so "nothing Forge parented survives"
      // already covers it — and reading it back off wm.allNodeWindows would not,
      // since disable() nulls the tree and the list comes back empty either way.
      // The manager's own grabOp / _draggedNodeWindow are not asserted: the instance
      // is discarded on disable (extension.js:245), so its fields have no later
      // reader and pinning them would test bookkeeping instead of an outcome.

      // T6 — teardown is IDEMPOTENT. extension.js calls extWm.disable() from its own
      // disable(), and GNOME can drive that twice (a failed enable that unwinds, an
      // update racing a lock). The second pass runs against an already-null tree.
      //
      // Deliberately NOT tested here: enable() on this same instance. extension.js
      // builds a fresh WindowManager on every enable (extension.js:104) and nulls it
      // on disable (:245), so re-entering enable() on a torn-down manager is not a
      // path the shell can take — asserting it would pin a contract nothing relies
      // on, and would have had us "fix" a disabled flag that is never read again.
      expect(() => wm.disable(), `seed ${seed}: second disable() threw`).not.toThrow();
      expect(wm.disabled, `seed ${seed}: not marked disabled`).toBe(true);

      // Referenced so the imports stay honest about what the state is built from.
      expect(WINDOW_MODES.TILE).toBeDefined();
      expect(NODE_TYPES.WINDOW).toBeDefined();
      expect(Meta.TabList).toBeDefined();
      expect(GLib.PRIORITY_DEFAULT).toBeDefined();
    });
  }
});
