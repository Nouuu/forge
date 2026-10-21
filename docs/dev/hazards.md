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
  after the fact: class 8 below lists them and their helpers (`Utils.getWorkAreaSafe`
  was the first). `Utils.getMonitorGeometrySafe` covers a null monitor index.

### 2. Disposed or finalized GObject wrapper
A `Meta.Window` wrapper can be disposed or finalized while JS still holds it. GJS flags the
wrapper when C code disposes its object, and again when the object is finalized. GJS's
critical names the cause: an object "destroyed from C code using something such as
destroy(), dispose(), or remove() vfuncs". A live-looking reference obtained before an async
hop may be dead by the time the handler runs (Bug #328). Whether a window Forge tracks can
reach either state is left to `close-spec-gaps-followups:F70`.

GJS does not throw on such a wrapper. `ObjectBase::to_c_ptr` (`gi/object.cpp`, read in GJS
1.78 and in master) logs a critical, "has been already finalized" or "disposed". It still
converts the wrapper to a C pointer. The pointer is NULL once the object is finalized, and
the live pointer while the object is only disposed. A property read on a finalized wrapper
logs the same critical and gives `undefined`. A method call goes on into Mutter.

What happens next is up to Mutter. `meta_window_get_title` checks `META_IS_WINDOW (window)`,
logs a second critical and returns NULL. `meta_window_get_id` and `meta_window_get_monitor`
do not check (Mutter 45 to 50). On a finalized wrapper they dereference NULL. That is the
class 8 failure, reached through a dead wrapper.

- **Guardrail (runtime):** `Utils.isWindowAlive()` probes `get_id()` inside a `try/catch`.
  There is no throw to catch. The probe sees a null reference or a non-window, and nothing
  else. A disposed wrapper still answers, after a critical. On a finalized one, `get_id()` is
  `meta_window_get_id (NULL)`. Pair the probe with a structural check, the node's
  `parentNode`. `Tree.pruneDeadWindows()` prunes once per render. `disconnectSignals()` wraps
  each `disconnect()` in `try/catch` so one bad target cannot stop the loop (Bug #328).
- **Guardrail (runtime):** the e2e fuzzer's log scan treats `finalized` /
  `deallocated` / `Gjs-CRITICAL` frames as failures. GJS reports a dead wrapper as a
  critical, not as an exception, and the scan reads that critical.
- **Gap:** no static rule — many raw getters (`get_frame_rect`, `get_title`, …)
  rely on the caller's context being "known live". Hard to prove statically.
- **Gap:** `Utils.isWindowAlive()` and the `finalizeWindow` test double
  (`tests/mocks/helpers/finalizeWindow.js`) still model a dead wrapper as one that throws.
  A probe and a double that follow GJS are `close-spec-gaps-followups:F70`.

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
- **Guardrail (version dispatch):** `Compat.getDefaultSeat()` covers the one
  Clutter API Forge called outside compat. MetaBackend has no public `get_default_seat`
  on any supported release, so an earlier `global.backend` probe never matched; the seat
  comes from the ClutterBackend, through the stage's ClutterContext from 47 and
  `Clutter.get_default_backend()` on 45-46 (removed on 51). Its caller sits inside the
  focus handler, so a throw there breaks focus on every window change: the shim degrades
  to null. `tests/e2e/tests/test_move_pointer_focus.py` runs it against a real shell on
  every lane.
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

### 8. A Mutter call aborts the shell on a window state
A Mutter function can `g_assert`, or dereference a pointer it expects to be set, on a window in
the wrong state. That window is one Mutter is closing (no actor, no workspace, no monitor), or
one whose monitor just went away. It is not a JS exception. The shell process dies, and on
Wayland the session goes with it. It happened live on GNOME 50.1 Wayland (`close-spec-gaps:N17`,
`meta_window_get_workspaces: code should not be reached`).

Forge meets these states because a closing window stays in the tree until its actor is
destroyed. `meta_window_unmanage` has already dropped the actor by then. It then clears the
maximize flags, the workspace and the monitor, in that order (Mutter 45 to 50). A render in
that gap could still place, maximize or unmaximize the window.

The table lists what each `Meta.Window` call needs. It comes from Mutter's `window.c` for each
release from 45 to 50. Where a call reaches `compositor.c`, `window-actor.c` or
`monitor-manager.c`, those were read too. "No workspace" is `get_workspace()` null:
`meta_window_get_workspaces` asserts for a window on no workspace, not on all of them and not
constructing. "No monitor" is `get_monitor()` of -1. "Past the count" is a monitor number at or
past `global.display.get_n_monitors()`. Mutter looks a monitor up by number, and the lookup
gives NULL there. A maximize that adds no direction, and an unmaximize of a window that is not
maximized, do not reach these reads. A maximizable window has `has_maximize_func`. Mutter
clears it for a window that is not a normal window, cannot be resized or is fullscreen.

| Call | Aborts when | Releases | Guard |
| --- | --- | --- | --- |
| `get_work_area_current_monitor()` | the window has no workspace | 45 to 50 | `Utils.getWorkAreaSafe` |
| `get_work_area_current_monitor()` | the window has no monitor: 45 and 46 dereference the NULL `window->monitor`, 47 to 50 assert `(logical_monitor)` | 45 to 50 | `Utils.getWorkAreaSafe` |
| `get_work_area_current_monitor()` | the window's monitor is past the count: 45 and 46 look it up by number | 45, 46 | `Utils.getWorkAreaSafe` |
| `get_work_area_for_monitor(i)` | the window has no workspace | 45 to 50 | `Utils.getWorkAreaForMonitor` |
| `get_work_area_for_monitor(i)` | `i` is past the count (`g_assert (logical_monitor)`); a negative `i` fails `g_return_if_fail (which_monitor >= 0)` and leaves the rect unset | 45 to 50 | `Utils.getWorkspaceWorkArea` |
| `get_work_area_all_monitors()` | the window has no workspace | 45 to 50 | none yet |
| `move_to_monitor(i)` | the window has no monitor: it reads `window->monitor->number` first | 45 to 50 | `Utils.moveToMonitorSafe` |
| `move_to_monitor(i)` | the window has no workspace, its monitor is past the count, or `i` is past the count (a negative `i` is the `g_return_if_fail` above): it reads the work area of both monitors | 45 to 50 | `Utils.moveToMonitorSafe` |
| `move_to_monitor(i)` | the window has no actor and `i` is another monitor: `meta_window_actor_size_change` dereferences it. 45 to 49 get there for a window whose rect overlaps its old work area, 50 for a window that is not hidden | 45 to 50 | `Utils.moveToMonitorSafe` |
| `maximize` (49 and 50: `set_maximize_flags`, then `maximize()`) | the window has no actor: `meta_window_actor_size_change` dereferences it | 45 to 50 | `Compat.maximize` |
| `maximize` | the window has a monitor and no workspace: `meta_window_recalc_features` reads the monitor's work area, which asserts | 45 to 50, a maximizable window | `Compat.maximize` |
| `maximize` | the window's monitor is past the count: the same read looks it up by number | 45, 46, a maximizable window | `Compat.maximize` |
| `unmaximize` (49 and 50: `set_unmaximize_flags`, then `unmaximize()`) | the window is maximized and has no monitor: 45 and 46 dereference the NULL `window->monitor`, 47 to 50 assert `(logical_monitor)` | 45 to 50 | `Compat.unmaximize` |
| `unmaximize` | the window is maximized and its monitor is past the count: 45 and 46 look it up by number | 45, 46 | `Compat.unmaximize` |
| `unmaximize` | the window is maximized and has no workspace | 45 to 50 | `Compat.unmaximize` |
| `unmaximize` | the window is maximized and has no actor: `meta_window_actor_size_change` dereferences it | 45 to 50 | `Compat.unmaximize` |

`Meta.Workspace` has `get_work_area_for_monitor` and `get_work_area_all_monitors` too. They do
not abort on a bad index or a missing monitor. For an index past the last monitor,
`meta_workspace_get_work_area_for_monitor` only fails a `g_return_if_fail` and leaves the rect
unset. So `Utils.getWorkAreaForMonitor` asks the window's workspace (else the active one),
never the window. `Utils.getWorkspaceWorkArea` is that workspace form, and it checks the index.
`no-raw-abort-api` bans the four names whatever the receiver. A lint rule has no types to tell
a window from a workspace. `get_work_area_all_monitors` has no helper yet, and nothing calls
it. The first caller adds a guarded helper to `utils.js`, the one file the rule exempts.

- **Guardrail (blocking):** `local/no-raw-abort-api` (`eslint-rules/`) reports
  `get_work_area_current_monitor`, `get_work_area_for_monitor`, `get_work_area_all_monitors`
  and `move_to_monitor` in `lib/`, `extension.js` and `prefs.js`, except in
  `lib/extension/utils.js`. It matches the property name on any receiver. It also matches a
  bare reference (`const f = win.move_to_monitor`, `.call`, a callback). A reference can run
  later with the guard skipped. Computed (`win["move_to_monitor"]`) and destructured access
  are not matched, a limit `no-raw-maximize-api` shares. The e2e bridge is outside its scope:
  it drives Mutter on purpose.
- **Guardrail (in-code):** `lib/extension/utils.js` owns the raw calls, through
  `getWorkAreaSafe`, `getWorkspaceWorkArea`, `getWorkAreaForMonitor` and `moveToMonitorSafe`.
  `get_work_area_all_monitors` has no helper yet. Each helper checks the preconditions of its
  call, whatever the release, and returns null or false without calling Mutter.
- **Guardrail (in-code):** a render never places, maximizes or unmaximizes a window Mutter has
  unmanaged, one whose `get_compositor_private()` is null. The `Tree.apply` filter and
  `_repositionOccludedDialog` skip it. `_tiledWindowsOnMonitor` still counts a closing tile
  until its node leaves the tree, so maximize-on-single and the single-tile rules keep their
  timing. The maximize shim is what stops a maximize there.
- **Guardrail (in-code):** `Compat.maximize` and `Compat.unmaximize` share `canChangeMaximize`:
  an actor, then the `getWorkAreaSafe` checks, a monitor in range and a workspace. It reads the
  actor first, and so does `Utils.moveToMonitorSafe`. On a finalized wrapper GJS passes NULL
  (class 2). `meta_window_get_compositor_private` checks for NULL and `meta_window_get_monitor`
  does not (Mutter 45 to 50). So the first read refuses that wrapper, and nothing dereferences
  it. For a maximize, a window with no monitor is a conservative refusal, since
  `meta_window_recalc_features` skips its work-area read there. `compat.js` cannot import
  `utils.js` (an import cycle), so it repeats the checks. Both shims check before the version
  dispatch, so every release is covered. `no-raw-maximize-api` (class 5) already forces every
  maximize and unmaximize through them.
- **Guardrail (unit):** the `Meta.Window` double (`tests/mocks/gnome/Meta.js`) throws where
  Mutter aborts on any release from 45 to 50. It also throws where Mutter reads an unset rect
  (a negative monitor index). A test window has a workspace and a monitor unless the test
  removes them (see `tests/README.md`). Three tests in `tests/regression/` pin it.
  `bug-close-spec-gaps-n17-workspace-less-window-work-area.test.js` pins the first crash.
  `bug-close-spec-gaps-n18-mutter-abort-guards.test.js` pins the helpers, their call sites and
  the double. `bug-close-spec-gaps-n18-unmanaged-window-render.test.js` pins the render and
  the shims, on 47.0 and 50.0.
- **Gap:** nothing proves this against a real shell. The double encodes what was read in
  Mutter's source. Only a real session shows a precondition that was missed. A stress lane
  would open and close transient windows and dialogs while Forge renders, and fail when the
  shell aborts. That lane is `close-spec-gaps-followups:F69`.
- **Gap:** only `window.c`, and what its calls reach, was read. A render still calls
  `make_above`, `unmake_above` and `lower` on a window with no actor. It still calls
  `move_resize_frame` on a window with no workspace or monitor. Their preconditions are not
  audited, nor are the other Mutter calls in `workspace.c`, `display.c`, `constraints.c` and
  the compositor (`close-spec-gaps-followups:F70`).

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
- **Coverage ratchet** (`npm run test:coverage`, blocking in CI): two runs, two floors.
  `vitest.config.js` holds `lib/`, `extension.js` and `prefs.js` to 90 / 85 / 90 / 90;
  `vitest.prefs.config.js` holds `lib/prefs/` to its own floor. Each floor sits below the
  measured baseline: raise, never lower. See `tests/README.md`.
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
