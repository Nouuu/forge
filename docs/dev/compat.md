# Mutter API compatibility

Forge supports GNOME Shell 45+. Several `Meta.Window` APIs changed signature across
releases (most at Mutter 49). **All version drift is centralized in
`lib/extension/compat.js`** as small dispatch shims; callers do
`import * as Compat from "./compat.js"` and use `Compat.<shim>(window)`.

## The pattern

```js
const SHELL_MAJOR = parseInt(PACKAGE_VERSION.split(".")[0], 10);   // shell-version.js
export const IS_MUTTER_49_PLUS = SHELL_MAJOR >= 49;                // compat.js (imports SHELL_MAJOR)
```

GNOME Shell and Mutter share a version (same release cycle), so the Shell major
version is a reliable Mutter-capability gate. Each shim is a plain exported function
that branches `if (IS_MUTTER_49_PLUS) { … } else { … }`. Version dispatch (not
`try/catch`) is deliberate: it reads clearly, costs no exception on the hot path,
and self-documents which API landed where.

## Current shims (`compat.js`)

| Shim | Mutter ≤ 48 | Mutter ≥ 49 |
| --- | --- | --- |
| `isMaximized` / `isNotMaximized` | `get_maximized() === BOTH` / `=== 0` | `is_maximized()` |
| `maximize(w, flags)` | `maximize(flags)` | `set_maximize_flags(flags)` + `maximize()` |
| `unmaximize(w)` | `unmaximize(BOTH)` | `set_unmaximize_flags(BOTH)` + `unmaximize()` |
| `getMaximizeFlags` | `get_maximized()` | `get_maximize_flags()` |

Shims on other cutoffs:

| Shim | Before the cutoff | From the cutoff |
| --- | --- | --- |
| `boxOrientation(vertical)`, St.BoxLayout direction | 45-47: `{ vertical }` | 48+ (`IS_MUTTER_48_PLUS`): `{ orientation }` |
| `isWaylandCompositor()` | 45-49: `Meta.is_wayland_compositor()` | 50+ (`IS_MUTTER_50_PLUS`): `true`, the X11 backend and the predicate are gone |
| `getDefaultSeat()`, the ClutterSeat (null on failure) | 45-46: `Clutter.get_default_backend()` | 47+ (`IS_MUTTER_47_PLUS`): `global.stage.context.get_backend()`; 51 removed `Clutter.get_default_backend()`. MetaBackend has no public `get_default_seat` on any release |

`compat.js` also holds one **capability probe**, which branches on whether a method
exists rather than on a version, for an API with no documented cutoff to dispatch on:

| Probe | Prefers | Falls back to |
| --- | --- | --- |
| `isAlwaysOnAllWorkspaces` | `is_always_on_all_workspaces()` | `is_on_all_workspaces()` |

## Drift map (reference)

`meta_window_*` across the tags Forge supports:

- `meta_is_wayland_compositor`: **removed at 50** with the X11 backend; every 50+ session is
  Wayland. A guard that probes the function reads false there (Nouuu/forge#2).
- `maximize` / `unmaximize`: **48** `(window, flags)` → **49+** `(window)` no-arg
  (flags now set separately via `set_maximize_flags` / `set_unmaximize_flags`).
- `get_maximized` (returns `MetaMaximizeFlags`): **removed at 49**; replaced by
  `is_maximized()` (gboolean) and `get_maximize_flags()`.
- `set_unmaximize_flags` (**49+**) **early-returns** unless the window was actually
  maximized — so on a tile-mode-but-not-maximized window it does **not** clear
  `tile_mode`.
- `meta_window_untile` is `META_EXPORT_TEST` (private, not callable from GJS) across
  48/49/50 — the API gap that forces Forge's 1px-shave geometry workaround for the
  Wayland tile-inference bug.
- `begin_grab_op` signature changed at 49, but Forge doesn't call it from GJS — no
  impact.

St, same tags:

- `St.BoxLayout`: `orientation` exists from **48**; `vertical` is deprecated at 48 and
  **removed at 51**, where GJS throws on it as a construct property. On 45-47, assigning
  `orientation` only sets a JS expando, so the box keeps its default direction.

## Adding a new shim

1. Add an exported function to `compat.js` with version dispatch.
2. If it's a new cutoff, add an `IS_MUTTER_NN_PLUS` constant.
3. Replace every callsite with the shim.
4. **Acceptance:** `grep -nE "metaWindow\.<changed-api>" lib/extension/ extension.js`
   should match **only** inside `compat.js`.

For the rare downstream-distro backport where version ≠ capability, switch that one
shim's dispatch from the version constant to a feature check
(`typeof w.method === "function"`) — same module, same callsites.

> The behavioral guardrails here (the try-new-shape recipe and the
> `set_unmaximize_flags` early-return trap) are also kept as `bd` memories so they
> surface in agent context, not just on a docs read.
