# Rendering & placement pipeline

How a tree mutation becomes on-screen geometry. Entry point: `renderTree()` in
`window.js`. See [architecture.md](architecture.md) for the surrounding subsystems.

## `renderTree(from, force)` — `window.js`

Renders are **debounced** through a single `GLib.idle_add` source so the bursts of
GNOME signals that follow one user action collapse into one layout pass.

- If render is frozen (mid-grab) or `tiling-mode-enabled` is off, it only refreshes
  decorations/borders and returns.
- Otherwise it schedules the idle body **once** (guarded by `_renderTreeSrcId`).

The idle body (`window.js`) runs this exact order — **the order is
load-bearing**:

```
tree.pruneDeadWindows()              // drop nodes whose Meta.Window wrapper is finalized —
                                     // one dead wrapper would throw out of every later step (forge-4b6)
processFloats()                      // classify every window TILE vs FLOAT
_reconcileFullscreenFloatDemotion()  // after processFloats, which re-pins floats (forge-zo4)
tree.render(from)                    // compute rects + move tiled windows
handleMaximizeOnSingle()             // maximize a lone tiled window per monitor
updateDecorationLayout()             // tab/stack decorations
updateBorderLayout()                 // focus/split borders
```

The source ID is reset in a `finally` (`window.js`): if a throw left it set,
every future `renderTree()` would no-op and new windows would stay floating
(Bug #531 / forge-cuv).

## `processFloats()` — `window.js`

Runs **every render**, unconditionally re-deciding tile-vs-float for each window:

```
nodeWindow.float = isFloatingExempt(w) || !workspaceTiled(w) || !monitorTiled(w)
```

There is **no persisted-float guard**. Consequence: any `Meta.Window` property
change that should affect tiling (e.g. `notify::wm-class`, `notify::above`) must be
wired to a per-window signal in `trackWindow` that calls `renderTree()`, or the
float decision is never re-evaluated.

## `tree.render → processNode → apply` — `tree.js`

- **`Tree.render(from)`** (`tree.js`) walks the tree.
- **`processNode`** (`tree.js`) sets each node's `renderRect` from its share of
  the parent, applying gaps/margins. Sibling sizes are percentage-based
  (`computeSizes` / `resetSiblingPercent` in `tree.js`).
- **`apply`** (`tree.js`) moves **every `mode === TILE` window** to its computed
  `renderRect` via `extWm.move()`.

### `move()` — the universal placement chokepoint (`window.js`)

Every tiled window is positioned here. It early-returns on a missing window and on
one under a live Forge grab (`grabMode` / `_draggedNodeWindow`, unless the caller
passes `commitDuringGrab`), and otherwise always calls `Compat.unmaximize()` before
`move_resize_frame`. It has **no fullscreen check** — the fullscreen exclusion lives
in `Tree.apply`'s tiled-children filter, which is where fullscreen-dependent
placement logic belongs.

### Fullscreen / maximize gotchas

A fullscreen window keeps `mode === TILE` (fullscreen doesn't change node mode), so:

- `apply()` must **filter `is_fullscreen`** out of its tiled children, or it
  re-slices the fullscreen window to a split rect.
- `handleMaximizeOnSingle()` (`window.js`) maximizes the sole tiled window per
  monitor — but must **skip a lone fullscreen window** (it reads as not-maximized).
- `updateDecorationLayout()` (`window.js`) hides decorations on monitors with a
  maximized/fullscreen window, and its filter must also exclude **minimized**
  windows.

Headless E2E can't discriminate these geometry bugs (Mutter clamps fullscreen/
maximize itself) — prove them with unit tests at the `move()`/`apply()` level.

## Tree reload vs. render

`tree.reload()` (`tree.js`) is the **only full tree wipe**: it clears children and
recreates the `WORKSPACE`/`MONITOR` scaffold at the live workspace and monitor
counts, after which `reloadTree` re-tracks windows **flat**. `STACKED`/`TABBED`
groupings survive it — `reloadTree` brackets the wipe with
`snapshotLayoutGroups()` / `restoreLayoutGroups()` (forge-bqa, nested sub-splits
included via forge-4y80). Four callers reach it (`reloadTree`, `window.js`):
`enable()`, `workspaces-reordered`, `monitors-changed`, and the
no-`mo{m}ws{n}`-node fallback inside `trackWindow`.

Everything else **preserves** the tree by routing to `renderTree` (which never
clears containers): workareas-changed, workspace add/remove and active-workspace
all re-track or re-render without wiping.

**Monitor hot-plug is the one case that must wipe.** The `mo{m}ws{n}` scaffold is
only ever built by `addWorkspace` -> `tree.addMonitor`, and `addWorkspace` returns
early once the `ws{n}` node exists — so nothing rebuilds it in place, and there is
no `removeMonitor`. `_onMonitorsChanged` therefore reloads, which recreates the
nodes at the new count and tears down the stale `St.Bin`s in one step. The signal
is `Main.layoutManager::monitors-changed` — **MetaDisplay does not emit it**
(forge-0rb6) — and the handler ignores a zero-monitor report so a KVM switch or
lock does not wipe the tree.

## Floating subsystem

Float is the node's `mode` (`FLOAT`), set by `processFloats` each render — a float
keeps its tree node, it is not detached.

- **`isFloatingExempt`** precedence is a three-step ladder, not two:
  1. An explicit per-window (`wmId`) or per-title (`wmTitle`) **tile** override wins
     outright.
  2. Otherwise a per-window/per-title **float** override wins (forge-11k) — this is
     what lets a "Picture-in-Picture" float rule beat the bundled class-only tile
     rules for Chrome/Brave/Chromium.
  3. Only then does a **bare class-only** tile override apply, and it does *not* drag
     float-by-role windows (dialogs, modals, transients, overlays) into the grid
     (forge-jbkg).

  Toggled via `toggleFloatingMode`
  (`window.js`); `Super+c` = per-window, `Super+Shift+c` = class-wide. A
  per-window remove must never delete a class-wide override.
- **Always-on-top** is re-pinned (`make_above`) by `processFloats` on every render,
  so any code changing a float's above-state must run *after* `processFloats` in the
  same idle. To put a float beneath a fullscreen window you need `unmake_above()`
  **and** `lower()` (unpin alone doesn't restack); restore re-raises with
  `make_above()`. Guard Forge's own toggles with a suppress flag so `notify::above`
  isn't read as a user pin.

## CSS / theme engine

`ThemeManagerBase` (`lib/shared/theme.js`) parses the stylesheet with the bundled
CSS parser in `lib/css/` and exposes `getCssProperty`/`setCssProperty`.
`updateDecorationLayout()` / `updateBorderLayout()` apply style classes
(`.window-tiled-border`, `.window-tabbed-tab`, palette classes …) to the actors.
Users override appearance at
`~/.config/forge/stylesheet/forge/stylesheet.css`; `patchCss()` syncs bundled
defaults into the user profile, and a GSettings trigger reloads the stylesheet.
