import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";

/**
 * WindowManager always-on-top ownership fuzzer
 *
 * A deterministic, seeded fuzzer over the `_forgeSetAbove` /
 * `_aboveDemotedForFullscreen` state machine. Each seed replays a randomized
 * sequence of the six things that touch it — the `float` setter, the
 * float-always-on-top setting being toggled off/on, the USER pinning or unpinning
 * by hand, a window entering or leaving fullscreen, the demotion reconcile, and a
 * tree reload — then asserts the ownership invariants those paths share.
 *
 * WHY THIS EXISTS. Every defect this file guards against shipped green under a
 * suite of ~1800 example-based tests, because each path was covered on its own and
 * nobody had written the transition BETWEEN two of them:
 *
 *   - cleanupAlwaysFloat unpinned without clearing ownership, so the reconcile
 *     re-pinned what the user had just disabled (window-modes G1/G12).
 *   - restoreAlwaysFloat pinned without claiming ownership, so its pin was
 *     invisible to both the reconcile and unfloat (G2).
 *   - the flags lived on the tree NODE, which every reload destroys, while the
 *     GNOME pin they describe lives on the Meta.Window and survives it (G11).
 *   - _handleUserAboveChange did not drop ownership when the USER unpinned, so a
 *     later re-pin read as Forge's own. Found by code review, not by the suite:
 *     removing that fix and its three tests still left 1851 tests green.
 *
 * They are one bug class — an expando with several writers where one fails to
 * maintain it — so they get one structural guard instead of four more examples.
 * A failing seed prints its operation log so the session is reproducible.
 */

// Small deterministic PRNG (no deps). One seed -> one replayable session.
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

const OPS = [
  "float-on",
  "float-off",
  "setting-off",
  "setting-on",
  "user-pin",
  "user-unpin",
  "fullscreen-on",
  "fullscreen-off",
  "reconcile",
  "restore-demoted",
  "reload",
];

// 64 fixed seeds — each is one deterministic ownership session. The count and the
// sequence length below are tuned for REACHABILITY, not for volume: a fullscreen
// demotion needs a pinned float AND another window fullscreen on the same monitor,
// so short sessions almost never reach the demoted state where two of the
// invariants below can fail at all.
const SEEDS = Array.from({ length: 64 }, (_, i) => 0xab0e_0000 + i * 0x9e37);

describe("WindowManager - always-on-top ownership fuzzer", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "float-always-on-top-enabled": true },
    });
  });

  afterEach(() => ctx.cleanup());

  /** Build N windows under the monitor; half float, half tile. */
  const buildWindows = (rng, seed) => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const metas = [];
    for (let i = 0; i < randInt(rng, 2, 4); i++) {
      const meta = createMockWindow({
        id: `${seed}-w${i}`,
        workspace: ctx.workspaces[0],
        // Non-resizable so processFloats has a standing reason to float it — a
        // window kept floating only by Forge's own pin is the G11 bug, not a state.
        allows_resize: rng() < 0.5,
      });
      // Track WHO applied the last pin. `__forgePinned` is test-only bookkeeping:
      // it is what lets the fuzzer assert the direction the flags alone cannot show
      // — that a pin Forge applied is a pin Forge claims.
      const realMake = meta.make_above.bind(meta);
      meta.make_above = () => {
        if (!ctx.__userAction) meta.__forgePinned = true;
        realMake();
      };
      const realUnmake = meta.unmake_above.bind(meta);
      meta.unmake_above = () => {
        if (!ctx.__userAction) meta.__forgePinned = false;
        realUnmake();
      };

      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta);
      node.mode = rng() < 0.5 ? WINDOW_MODES.FLOAT : WINDOW_MODES.TILE;
      metas.push(meta);
    }
    return metas;
  };

  /** What reloadTree does: wipe the tree, then re-track the same Meta.Windows. */
  const reload = (metas) => {
    const modes = new Map(metas.map((m) => [m, ctx.tree.findNode(m)?.mode]));
    ctx.tree.reload();
    const { monitor } = getWorkspaceAndMonitor(ctx);
    for (const meta of metas) {
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta);
      node.mode = modes.get(meta) ?? WINDOW_MODES.TILE;
    }
  };

  const applyOp = (op, wm, meta, metas) => {
    const node = ctx.tree.findNode(meta);
    switch (op) {
      case "float-on":
        if (node) node.float = true;
        break;
      case "float-off":
        if (node) node.float = false;
        break;
      case "setting-off":
        ctx.extension.settings.set_boolean("float-always-on-top-enabled", false);
        wm.cleanupAlwaysFloat();
        break;
      case "setting-on":
        ctx.extension.settings.set_boolean("float-always-on-top-enabled", true);
        wm.restoreAlwaysFloat();
        break;
      case "user-pin":
        // The user acts from the window menu; Forge is not suppressing the signal.
        ctx.__userAction = true;
        if (!meta.is_above()) meta.make_above();
        ctx.__userAction = false;
        wm._handleUserAboveChange(meta);
        break;
      case "user-unpin":
        ctx.__userAction = true;
        if (meta.is_above()) meta.unmake_above();
        ctx.__userAction = false;
        // The last pin is no longer Forge's, whoever placed it.
        meta.__forgePinned = false;
        wm._handleUserAboveChange(meta);
        break;
      case "fullscreen-on":
        meta.make_fullscreen();
        break;
      case "fullscreen-off":
        meta.unmake_fullscreen();
        break;
      case "reconcile":
        wm._reconcileFullscreenFloatDemotion();
        break;
      case "restore-demoted":
        wm._restoreAllDemotedFloats();
        break;
      case "reload":
        reload(metas);
        break;
    }
  };

  /**
   * The ownership invariants, checked after EVERY operation rather than once at the
   * end. That distinction is not cosmetic: an end-of-sequence check misses any
   * violation a later operation happens to paper over, and two of the four defects
   * this file guards against are exactly that shape — a window left owned-but-unpinned
   * by one call, re-pinned by the next.
   */
  const checkInvariants = (metas, where) => {
    for (const meta of metas) {
      const owned = !!meta._forgeSetAbove;
      const demoted = !!meta._aboveDemotedForFullscreen;
      const id = meta.get_id();

      // I1 — ownership implies a pin that is either APPLIED or deliberately
      // SUSPENDED. `owned && !above && !demoted` is the stale-ownership state: Forge
      // believes it holds a pin that is not there, so a later unfloat strips a pin
      // the USER applied (the case FR-003 / bug-319 exist to prevent) and
      // isFloatingExempt stops reading that pin as a user overlay.
      expect(
        owned && !meta.is_above() && !demoted,
        `${where}: stale ownership on ${id} (_forgeSetAbove without a pin or a demotion)`
      ).toBe(false);

      // I1b — the same rule read the other way: a pin FORGE applied is a pin Forge
      // claims. Without it, restoreAlwaysFloat pinning without setting the flag (G2)
      // and ownership parked on the tree node, which every reload destroys (G11),
      // both leave a live Forge pin that nothing owns — invisible to the demotion
      // reconcile and to `set float(false)`, so it can be neither demoted under a
      // fullscreen window nor cleared by unfloating.
      expect(
        !!meta.__forgePinned && meta.is_above() && !owned,
        `${where}: unclaimed Forge pin on ${id} (make_above by Forge, no _forgeSetAbove)`
      ).toBe(false);

      // I2 — a fullscreen demotion only ever suspends a pin Forge OWNS. A demotion
      // flag without ownership makes _restoreAllDemotedFloats skip the window forever
      // (it re-pins only when owned), stranding a float below the layer it was
      // lifted from; demoting a user's pin is also not Forge's call.
      expect(demoted && !owned, `${where}: demotion without ownership on ${id}`).toBe(false);

      // I2b — a suspended pin is a pin Forge has actually let go of. `demoted` while
      // Forge holds the pin means the restore ran but forgot to clear the flag, so
      // the next reconcile treats an already-restored float as still owed a restore
      // and _restoreAllDemotedFloats keeps re-pinning it forever.
      //
      // Stated against __forgePinned rather than is_above() on purpose: a USER may
      // legitimately re-pin a demoted float by hand (see bug-469, "keeps the pending
      // fullscreen restore when the user re-pins a demoted float"), which leaves
      // `demoted && is_above()` — valid, because the pin is not Forge's.
      expect(
        demoted && !!meta.__forgePinned,
        `${where}: demotion flag held while Forge still owns the pin on ${id}`
      ).toBe(false);
    }
  };

  for (const seed of SEEDS) {
    it(`holds always-on-top ownership invariants for seed ${seed}`, () => {
      const rng = mulberry32(seed);
      const wm = ctx.windowManager;
      const metas = buildWindows(rng, seed);
      const log = [];

      expect(() => {
        for (let i = 0; i < randInt(rng, 8, 20); i++) {
          const op = pick(rng, OPS);
          const meta = pick(rng, metas);
          log.push(`${op}(${meta.get_id()})`);
          applyOp(op, wm, meta, metas);
          checkInvariants(metas, `seed ${seed}: ${log.join(" -> ")}`);
        }
      }, `seed ${seed}: ${log.join(" -> ")}`).not.toThrow();

      const where = `seed ${seed}: ${log.join(" -> ")}`;

      // Deterministic coda. The random walk reaches the demoted state often, but
      // almost never lands on demote-THEN-restore in sequence — and that pair is
      // where two of the invariants can fail at all. So every seed ends by walking
      // it explicitly, from whatever state the walk left behind. The setup uses
      // production calls only (cleanupAlwaysFloat for the clean slate), never a
      // hand-written flag, so the coda cannot manufacture a state the code cannot.
      if (metas.length >= 2) {
        const [floater, blocker] = metas;
        const fNode = ctx.tree.findNode(floater);
        if (fNode) {
          ctx.extension.settings.set_boolean("float-always-on-top-enabled", true);
          floater.unmake_fullscreen(); // a fullscreen window is never demoted
          fNode.mode = WINDOW_MODES.FLOAT;
          wm.cleanupAlwaysFloat(); // clean slate: nothing pinned, nothing owned
          checkInvariants(metas, `${where} | coda: cleaned`);

          fNode.float = true; // Forge pins and claims it
          checkInvariants(metas, `${where} | coda: pinned`);

          // There are TWO ways a demoted float comes back — the reconcile's own
          // restore branch, and _restoreAllDemotedFloats — so the coda walks a full
          // demote/restore cycle through each of them in turn. Restoring only via
          // the second left the first's re-pin unexercised.
          blocker.make_fullscreen();
          wm._reconcileFullscreenFloatDemotion(); // suspend the pin
          checkInvariants(metas, `${where} | coda: demoted (1)`);

          blocker.unmake_fullscreen();
          wm._reconcileFullscreenFloatDemotion(); // restore path A: the reconcile
          checkInvariants(metas, `${where} | coda: restored by reconcile`);

          blocker.make_fullscreen();
          wm._reconcileFullscreenFloatDemotion(); // demote again
          checkInvariants(metas, `${where} | coda: demoted (2)`);

          wm._restoreAllDemotedFloats(); // restore path B: the disable/setting-off pass
          checkInvariants(metas, `${where} | coda: restored by restoreAll`);
        }
      }

      // I3 — with the setting OFF, Forge owns nothing. cleanupAlwaysFloat is the
      // only path that runs on that transition, so anything it leaves behind is
      // ownership that outlived the feature it belongs to.
      if (!ctx.extension.settings.get_boolean("float-always-on-top-enabled")) {
        wm.cleanupAlwaysFloat();
        for (const meta of metas) {
          expect(
            !!meta._forgeSetAbove,
            `${where}: ownership survived the setting being off on ${meta.get_id()}`
          ).toBe(false);
        }
      }
    });
  }
});
