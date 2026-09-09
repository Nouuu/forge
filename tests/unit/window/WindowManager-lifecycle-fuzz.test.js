import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Rectangle } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager per-window bookkeeping fuzzer
 *
 * The sibling of WindowManager-above-fuzz, for the other two expandos Forge parks
 * on a Meta.Window: `windowSignals` (the per-window handler ids) and `firstRender`
 * (the Bug #530 one-shot that keeps a new window's open animation). Both are
 * written from one place and read from several, and both are re-entered by
 * `trackCurrentWindows()` — which now runs on monitor hot-plug as well as on
 * enable and on a workspace reorder, so a re-track is no longer rare.
 *
 * docs/dev/hazards.md class 7 named these two as the open half of the bug class the
 * always-on-top fuzzer closed. This is that half.
 *
 * The guards being pinned already exist and are correct — `_bindWindowSignals`
 * skips a window that already has ids, and `firstRender` is set inside the
 * `!existNodeWindow` branch so a re-track cannot re-arm it. They are one line each
 * and both are invisible in a diff, which is exactly the kind of guard that gets
 * dropped by a refactor with a green suite.
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

const OPS = ["track", "track-all", "reload", "move", "render", "destroy"];

const SEEDS = Array.from({ length: 48 }, (_, i) => 0xc0de_0000 + i * 0x9e37);

describe("WindowManager - per-window bookkeeping fuzzer", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  const buildWindows = (rng, seed) => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const metas = [];
    for (let i = 0; i < randInt(rng, 2, 3); i++) {
      const meta = createMockWindow({
        id: `${seed}-w${i}`,
        workspace: ctx.workspaces[0],
        allows_resize: true,
        rect: new Rectangle({ x: 0, y: 0, width: 480, height: 540 }),
      });
      // Test-only bookkeeping: did Forge strip this actor's transitions, and has
      // the window ever been through a real placement? Neither is derivable from
      // the expandos, and both are what the #530 contract is actually about.
      const actor = meta.get_compositor_private();
      const realStrip = actor.remove_all_transitions.bind(actor);
      actor.remove_all_transitions = () => {
        meta.__stripped = (meta.__stripped ?? 0) + 1;
        realStrip();
      };
      metas.push(meta);
    }
    // trackCurrentWindows reads the tab list, so the fixture has to report them.
    global.display.get_tab_list.mockReturnValue(metas);
    return metas;
  };

  /**
   * What reloadTree does around a destructive wipe — including the trailing
   * renderTree. Leaving that out models a state the shell never exposes: the
   * render is what places the re-tracked windows, and a placement is what consumes
   * the #530 one-shot.
   */
  const reload = (wm) => {
    const groups = ctx.tree.snapshotLayoutGroups();
    ctx.tree.reload();
    wm.trackCurrentWindows();
    ctx.tree.restoreLayoutGroups(groups);
    wm.renderTree("fuzz-reload");
  };

  const applyOp = (op, wm, meta, metas, rng) => {
    switch (op) {
      case "track":
        wm.trackWindow(global.display, meta);
        break;
      case "track-all":
        wm.trackCurrentWindows();
        break;
      case "reload":
        reload(wm);
        break;
      case "move": {
        // Only a TRACKED window is ever placed: every caller of move() starts from
        // a tree node (Tree.apply, resize, _handleMoving, updateMetaPositionSize).
        // Placing an untracked one models a sequence the shell cannot produce.
        if (!ctx.tree.findNode(meta)) break;
        // A real placement: a rect that differs from the current frame, or move()
        // short-circuits as a no-op (forge-wsc #351) and consumes nothing.
        const cur = meta.get_frame_rect();
        wm.move(meta, {
          x: cur.x === 0 ? 600 : 0,
          y: 0,
          width: randInt(rng, 300, 500),
          height: 540,
        });
        break;
      }
      case "render":
        wm.renderTree("fuzz");
        break;
      case "destroy": {
        const actor = meta.get_compositor_private();
        if (ctx.tree.findNode(meta)) wm.windowDestroy(actor);
        // Mutter drops a destroyed window from the tab list, so a later
        // trackCurrentWindows never sees it again. Model that, or the fuzzer
        // re-tracks a dead window — a sequence the shell cannot produce.
        meta.__destroyed = true;
        global.display.get_tab_list.mockReturnValue(metas.filter((m) => !m.__destroyed));
        break;
      }
    }
  };

  /**
   * Checked after EVERY operation — an end-of-sequence check misses a violation a
   * later call papers over, which is how the always-on-top fuzzer initially missed
   * half of the defects it was written for.
   */
  const checkInvariants = (metas, where) => {
    for (const meta of metas) {
      if (meta.__destroyed) continue; // gone from the shell; nothing to hold
      const id = meta.get_id();
      const tracked = !!ctx.tree.findNode(meta);

      // W1 — a window in the tree is a window Forge is listening to. A tracked node
      // without handlers silently stops reacting to position-changed / size-changed,
      // so the tree keeps a stale rect for a window the user is still moving.
      if (tracked) {
        expect(
          Array.isArray(meta.windowSignals) && meta.windowSignals.length > 0,
          `${where}: tracked node with no windowSignals on ${id}`
        ).toBe(true);
      }

      // W2 — re-tracking never re-connects. trackCurrentWindows runs on enable, on
      // workspaces-reordered and now on monitor hot-plug; without the
      // `if (!metaWindow.windowSignals)` guard each pass would add another full set
      // of handlers, and every later position-changed would fire N times.
      // Stated as stability, not as a count: the number of handlers is an
      // implementation detail that will change, while "a second track adds none"
      // is the contract. The first length seen is the baseline.
      if (Array.isArray(meta.windowSignals)) {
        meta.__signalBaseline ??= meta.windowSignals.length;
        expect(
          meta.windowSignals.length,
          `${where}: windowSignals grew on ${id} (handlers connected twice)`
        ).toBe(meta.__signalBaseline);
      }
      const actor = meta.get_compositor_private();
      if (actor && Array.isArray(actor.actorSignals)) {
        actor.__signalBaseline ??= actor.actorSignals.length;
        expect(
          actor.actorSignals.length,
          `${where}: actorSignals grew on ${id} (destroy handler connected twice)`
        ).toBe(actor.__signalBaseline);
      }

      // F1 — firstRender is a ONE-SHOT. `move()` consumes it; nothing may re-arm it,
      // and a re-track must not (it is set inside trackWindow's !existNodeWindow
      // branch for exactly that reason). Re-arming it would make the NEXT placement
      // skip remove_all_transitions() on a window that is not new, leaving an
      // in-flight shell effect running over a window Forge is repositioning.
      if (meta.__firstRenderCleared) {
        expect(
          !!meta.firstRender,
          `${where}: firstRender re-armed on ${id} after it was consumed`
        ).toBe(false);
      }
      if (meta.firstRender === false) meta.__firstRenderCleared = true;

      // F2 — the Bug #530 contract itself: a window still holding its one-shot has
      // never had its transitions stripped. This is the property the flag exists to
      // provide, stated directly rather than through the flag.
      if (meta.firstRender) {
        expect(
          meta.__stripped ?? 0,
          `${where}: transitions stripped on ${id} while its one-shot was still live`
        ).toBe(0);
      }
    }
  };

  for (const seed of SEEDS) {
    it(`holds per-window bookkeeping invariants for seed ${seed}`, () => {
      const rng = mulberry32(seed);
      const wm = ctx.windowManager;
      const metas = buildWindows(rng, seed);
      const log = [];

      expect(() => {
        for (let i = 0; i < randInt(rng, 6, 16); i++) {
          const op = pick(rng, OPS);
          const meta = pick(rng, metas);
          log.push(`${op}(${meta.get_id().slice(-2)})`);
          applyOp(op, wm, meta, metas, rng);
          checkInvariants(metas, `seed ${seed}: ${log.join(" -> ")}`);
        }
      }, `seed ${seed}: ${log.join(" -> ")}`).not.toThrow();

      const where = `seed ${seed}: ${log.join(" -> ")}`;

      // Deterministic coda: the walk rarely lands on track -> move -> move in
      // sequence, and that triple is the whole of the #530 contract — the first
      // real placement keeps the open effect, the second strips it.
      const fresh = createMockWindow({
        id: `${seed}-coda`,
        workspace: ctx.workspaces[0],
        allows_resize: true,
        rect: new Rectangle({ x: 0, y: 0, width: 480, height: 540 }),
      });
      const codaActor = fresh.get_compositor_private();
      const stripSpy = vi.spyOn(codaActor, "remove_all_transitions");
      global.display.get_tab_list.mockReturnValue([...metas.filter((m) => !m.__destroyed), fresh]);

      wm.trackWindow(global.display, fresh);
      expect(fresh.firstRender, `${where} | coda: new window has no one-shot`).toBe(true);

      wm.move(fresh, { x: 600, y: 0, width: 400, height: 540 });
      expect(
        stripSpy,
        `${where} | coda: first placement stripped transitions`
      ).not.toHaveBeenCalled();
      expect(fresh.firstRender, `${where} | coda: one-shot not consumed`).toBe(false);

      // A re-track must not hand it back.
      wm.trackCurrentWindows();
      expect(fresh.firstRender, `${where} | coda: re-track re-armed the one-shot`).toBe(false);

      wm.move(fresh, { x: 0, y: 0, width: 400, height: 540 });
      expect(stripSpy, `${where} | coda: later placement did not strip`).toHaveBeenCalled();

      // And a reload leaves the handler set alone, not doubled.
      reload(wm);
      const codaBaseline = fresh.__signalBaseline ?? fresh.windowSignals?.length;
      expect(fresh.windowSignals?.length, `${where} | coda: reload doubled windowSignals`).toBe(
        codaBaseline
      );
      expect(fresh.firstRender, `${where} | coda: reload re-armed the one-shot`).toBe(false);
      expect(ctx.tree.findNode(fresh)?.nodeType, `${where} | coda: lost after reload`).toBe(
        NODE_TYPES.WINDOW
      );
      expect(WINDOW_MODES.TILE).toBeDefined();
    });
  }
});
