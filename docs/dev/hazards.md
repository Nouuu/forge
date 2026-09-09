# Bug-class hazard catalog

Forge runs inside the GNOME Shell process against Mutter's GObject-introspected
APIs, so the recurring defects cluster into a handful of **classes** rather than
one-off mistakes. A 2026-07-24 analysis of the last ~100 fixes found roughly 40%
were statically preventable and 60% were runtime hazards (GJS finalization, actor
use-after-dispose, races, Mutter version drift). The `forge-fhen` anti-regression
program built a layered set of guardrails against these classes; this file is the
canonical map of **class → guardrail → known gap**.

Each guardrail is either **blocking** (fails CI / pre-commit) or **advisory /
runtime** (surfaces the defect but does not gate a merge). Prefer adding to a
blocking layer when a class can be caught statically.

## The classes

### 1. Chained nullable-getter deref
`metaWindow.get_workspace().index()` / `get_monitor()` fed straight into a
consumer. On an **unmanaged** window `get_workspace()` returns null and
`get_monitor()` returns `-1`, so the immediate deref throws / misbehaves ("window
died between the signal and the handler" — e.g. `forge-ib39`, `forge-7bry`).

- **Guardrail (blocking):** `local/no-unguarded-window-deref` (`eslint-rules/`)
  flags the immediate-chain shape and forces the idiomatic **capture-then-guard**
  form: `const ws = win.get_workspace(); if (!ws) return;`.
- **Note on shims:** we deliberately do *not* wrap these getters. A safe-shim
  wrapper is reserved for calls that **abort the shell** and thus can't be guarded
  after the fact — see `Utils.getWorkAreaSafe` (`get_work_area_current_monitor()`
  `g_assert`s on monitor `-1`) and `Utils.getMonitorGeometrySafe`.

### 2. Finalized GObject wrapper throws on *any* method
A disposed-but-not-yet-finalized `Meta.Window` wrapper throws on **every**
accessor, not only on a null return (Bug #328). A live-looking reference obtained
before an async hop may be dead by the time the handler runs.

- **Guardrail (runtime):** `Utils.isWindowAlive()` probes with a `try/catch`
  around `get_id()`; call it before touching a window whose liveness isn't
  guaranteed by the immediate caller. `disconnectSignals()` wraps each
  `disconnect()` in `try/catch` for the same reason.
- **Guardrail (runtime):** the e2e fuzzer's log scan treats `finalized` /
  `deallocated` / `Gjs-CRITICAL` frames as failures.
- **Gap:** no static rule — many raw getters (`get_frame_rect`, `get_title`, …)
  rely on the caller's context being "known live". Hard to prove statically.

### 3. Signal connect/disconnect discipline
A handler connected to a **long-lived external** object (`global.display`,
settings, a shared actor) whose id is discarded outlives Forge's teardown and
fires after `disable()` — the classic extension leak.

- **Guardrail (blocking):** `local/no-untracked-connect` fails on a discarded
  `.connect()` id. Exempt shapes: `connectObject(...)` (auto-tracked),
  `this.connect(...)` (self-connect — freed with the instance), and
  actor-lifetime-bound connects carrying a scoped `eslint-disable` with the reason
  (a destroyed actor auto-disconnects its own handlers). **Prefs** sources are
  exempt by file scope — the prefs GTK4 process is torn down wholesale on close.
- **Gap / TODO:** three manual tracking idioms still coexist in `window.js` /
  `config-sync.js`; `forge-fhen.7` will migrate them to
  `connectObject`/`disconnectObject` (deferred pending e2e validation).

### 4. Actor use-after-destroy
Touching a Clutter/St actor (or a window's `get_compositor_private()`) after it
has been destroyed/reparented — e.g. tab teardown racing a render (`forge-v2yz`,
`forge-5r0j`, the "St.BoxLayout already disposed" family).

- **Guardrail (in-code):** null-check `get_compositor_private()` and gate
  reparenting on `global.window_group.contains(actor)` (see `decoration.js`);
  null a dangling actor ref from the actor's own `destroy` handler.
- **Guardrail (runtime):** e2e fuzzer hazard sequences (spawn/drag/close
  adjacency) + the "already disposed" log markers.
- **Guardrail (unit):** `tests/unit/window/WindowManager-teardown-fuzz.test.js`.
  `disable()` is where a throw stops being a bug report and becomes an outage —
  GNOME catches it, marks the extension errored and will not load it again without
  the user intervening — and it runs at the worst moments (lock, suspend, update).
  The fuzzer builds a randomized shell state (arbitrary layouts, floats, pinned and
  fullscreen-demoted floats, a finalized wrapper, an in-flight grab, armed sources)
  and asserts what teardown owes: no throw, no surviving GLib source, no surviving
  handler, nothing Forge parented left in `window_group`, and idempotence. It found
  the last unguarded deref of a finalized wrapper — `windowsAllWorkspaces` sorting
  by `get_stable_sequence()`, which put a throw inside both `disable()` and
  `trackCurrentWindows()`.
- **Gap:** the drop-preview actor's release through `disable()` is not asserted —
  the gesture that builds it is not reproducible in the unit fixture (measured: 0 of
  40 seeds). `WindowManager-grab-fuzz` covers its release through
  `_handleGrabOpEnd`.

### 5. Mutter version drift
A `Meta.Window` API whose signature/availability changed across releases (most at
Mutter 49) called directly, so it crashes on the other version.

- **Guardrail (blocking):** `local/no-raw-maximize-api` bans the raw
  maximize/unmaximize APIs everywhere except `lib/extension/compat.js`, forcing
  all callers through the version-dispatch shims. Full drift map + recipe:
  [compat.md](compat.md).
- **Guardrail (capability probe):** `Compat.getDefaultSeat()` covers the one
  Clutter API Forge called outside compat. It is probed, not version-dispatched:
  there is no documented cutoff, only two accessors (`global.backend`, Shell's, and
  `Clutter.get_default_backend()`, Clutter's) that have each been the current one.
  Its caller sits inside the focus handler, so a throw there broke focus on every
  window change — and the setting that reaches it (`move-pointer-focus-enabled`)
  appears nowhere in `tests/e2e`, so that path had never run against a real shell on
  any supported GNOME version.
- **Gap:** `get_active_workspace*` is called directly at ten sites, split between
  `global.workspace_manager` and `global.display.get_workspace_manager()`, some with
  optional chaining and some without. No drift is documented for either accessor, so
  this is an inconsistency to settle rather than a shim to write — do not add a
  version dispatch without first establishing a cutoff (see "Adding a new shim").

### 6. GLib source-id leaks
A `GLib.timeout_add` / `idle_add` whose id is not removed on the owning object's
teardown keeps firing against a dead object.

- **Guardrail:** `tests/unit/extension/source-id-hygiene.test.js` — a fence that
  DISCOVERS the ids by parsing `lib/` rather than listing them, then asserts each one
  is released on its owner's teardown (`WindowManager._removeSignals`,
  `ConfigSync.destroy`, the per-window sweep in `disable()`), and that no site
  discards its id outright. Add a timeout anywhere in `lib/` and the fence fails
  until it is cleared — no test edit needed, which is the point: a hand-maintained
  list drifts exactly like the one it guards.
- **Why not a lint rule:** `no-untracked-timeout` was the obvious answer and is the
  wrong one. All 12 sites already store their id, so a per-node rule sees nothing
  wrong; the defect lives in the *teardown*, a different function, out of a lint
  rule's reach.
- **Gap:** `lib/prefs/widgets.js` (`_saveSourceId`) is not fenced — it lives in the
  prefs process, which is torn down wholesale, so a stale source cannot outlive it.

### 7. Multi-writer expando state on a `Meta.Window`
Forge parks bookkeeping directly on the `Meta.Window` — `_forgeSetAbove`,
`_aboveDemotedForFullscreen`, `_forgeTransientAbove`, `_forgeStackTimeoutId`,
`windowSignals`, `firstRender`. Each is written from several places and read from
several others. The defect shape is always the same: one writer changes the world
without maintaining the flag that describes it, and the state starts lying.

Every instance shipped green under example-based tests, because each path was
covered on its own and nobody had written the transition BETWEEN two of them:

- `cleanupAlwaysFloat` unpinned without clearing ownership, so the reconcile
  re-pinned what the user had just disabled.
- `restoreAlwaysFloat` pinned without claiming ownership — and, later, re-pinned a
  float the reconcile had deliberately suspended, lifting it back over a fullscreen
  window.
- the `float` setter re-applied that same suspended pin on every render, since
  `processFloats` re-derives `float = true` each time.
- ownership lived on the tree NODE, which every `Tree.reload()` destroys, while the
  GNOME pin it describes lives on the window and survives.
- `_handleUserAboveChange` did not drop ownership when the USER unpinned.

- **Guardrails:** two seeded fuzzers, one per group of flags.
  `WindowManager-above-fuzz.test.js` covers the always-on-top pair;
  `WindowManager-lifecycle-fuzz.test.js` covers `windowSignals` / `actorSignals`
  (re-tracking must never re-connect) and `firstRender` (a one-shot nothing may
  re-arm). Both replay randomized operation sequences against the real handlers and
  check their invariants **after every operation**, not once at the end — an
  end-state check misses a violation a later call papers over, which is how the
  first version of the above-fuzzer missed half the defects it was written for.
  Both end with a deterministic coda for the transitions a random walk almost never
  reaches in sequence (demote-then-restore through each restore path; track → move
  → re-track → move).

  Three defects were found by these fuzzers rather than by review: `restoreAlwaysFloat`
  lifting a demoted float back over a fullscreen window, the `float` setter
  re-applying that suspended pin on every render, and `trackWindow` re-arming the
  `firstRender` one-shot on every reload (`= true` where `??= true` was meant).

- **Writing one:** model the shell faithfully or the fuzzer reports states the
  system cannot reach. Three false alarms came from a sloppy model — a destroyed
  window left in the tab list, a `reload` missing its trailing `renderTree`, and
  `move()` applied to an untracked window. Each cost a debugging round; each was the
  test being wrong, not the code. State invariants against behaviour where you can
  (`__forgePinned`, `__stripped`) rather than against the flag under test, or the
  invariant just restates the implementation.
- **Gap:** `actorSignals` teardown on `windowDestroy` is not asserted (the wrapper
  is finalized, so the ids die with it — verified, not pinned).

## Cross-cutting guardrails

- **`tsc --checkJs` + `strictNullChecks`** (blocking) — null-safety on typed GNOME
  returns; catches class 1 at the type layer where the return is annotated. Needs
  the `@girs/*` ambient types (`types/ambient.d.ts`).
- **`tree.verifyIntegrity()`** (dev builds) — parent-ref / cycle / duplicate /
  empty-container invariants after tree mutations; the same rule family the e2e
  fuzzer checks, run inline on every dev render (log-and-continue).
- **Seeded unit fuzzers** (`tests/unit/window/WindowManager-grab-fuzz.test.js`,
  `WindowManager-above-fuzz.test.js`, `WindowManager-lifecycle-fuzz.test.js`,
  `WindowManager-teardown-fuzz.test.js`) — deterministic operation sequences against the
  real handlers, asserting the invariants those handlers own. Cheaper and more
  targeted than the e2e fuzzer; use one when a class has several writers of one
  piece of state.
- **Seeded e2e fuzzer** (`tests/e2e/fuzz/`) — stateless step executor with an
  oracle bundle (liveness eval, `fuzzCheckInvariants`, log scan) after every step;
  ddmin shrinker for repros. Invariant list: `tests/e2e/README.md`.
- **Coverage ratchet** (`vitest.config.js`) — a floor below the measured baseline;
  raise, never lower.
- **CSS property round-trip tests** (`tests/unit/css/roundtrip.test.js`) — seeded
  in-grammar stylesheets assert `stringify(parse(x))` is a fixed point (the
  `forge-y3jy` data-loss cluster).
- **Regression corpus** (`tests/regression/bug-*.test.js`) — one pinned test per
  historical defect.

## Adding a guardrail

When a *new* class emerges (two or more fixes sharing a shape), prefer the
cheapest blocking layer that can catch it: a `tsc` annotation, then a repo-local
ESLint rule (`eslint-rules/` + a test in `tests/unit/eslint-rules/`), then a
runtime invariant in `verifyIntegrity`/the fuzzer. Land new rules as `warn` while
burning the existing violations, then promote to `error` — the same path
`no-untracked-connect` and `no-unguarded-window-deref` took in `forge-fhen.12`.
