# Multi-monitor

Forge maintains a separate tiling tree per monitor, per workspace. Each monitor's
default split direction follows its **own** geometry — portrait monitors split
vertically, landscape monitors split horizontally.

## Where new windows open

`new-window-placement` (Preferences, Tiling page, Behavior group):

- **`pointer`** (default) — a new window tiles on the monitor with the pointer.
- **`window-actual`** — a new window tiles on the monitor it actually opened on
  (respects app-restored geometry).
- **`focus`** — a new window tiles on the focused window's monitor (pointer monitor
  when nothing is focused).

If windows open on the "wrong" monitor, try switching this setting.

## Excluding a monitor from tiling

`monitor-skip-tile` — a comma-separated list of monitor **indices** to leave alone
(windows there are never tiled). Likewise `workspace-skip-tile` excludes whole
workspaces by index. Use these for a monitor dedicated to a floating app (chat,
media) — or as a workaround for the vertical-monitor limitation below.

## Known limitations

- **Vertical / portrait monitor setups are not fully supported** — focus and
  navigation across a portrait secondary monitor can misbehave. Excluding that
  monitor via `monitor-skip-tile` is the current workaround.
- **Dynamic workspaces work.** Adding or removing a workspace renumbers every
  `ws{n}` / `mo{m}ws{n}` node, and `workspace-skip-tile` is renumbered with them — an
  excluded workspace stays excluded as it shifts, and its entry is dropped when the
  workspace itself goes away. `monitor-skip-tile` is *not* index-tracked: unplugging a
  monitor renumbers the ones above it, so check that list after a display change.

Forge handles a monitor hot-plug through the shell's `monitors-changed` signal:

- A report of no monitors is ignored, so a KVM switch, a lock or DPMS off does not
  wipe the tree.
- The same monitor set (same primary, same geometries) only re-renders the layout.
- A changed set reloads the tree (`reloadTree()`): Forge rebuilds the `mo{m}ws{n}`
  nodes for the new monitors and adds every window back to the tree. Stacked and
  tabbed groups survive the reload when at least two of their windows land back
  together on one monitor. A window closed meanwhile drops out of its group, and a
  group scattered across monitors comes back in part or not at all.

`Super+Shift+r` reloads the config files, not the tree. If a layout looks wrong after
a display change, see [troubleshooting.md](troubleshooting.md).
