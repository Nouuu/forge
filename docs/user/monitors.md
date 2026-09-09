# Multi-monitor

Forge maintains a separate tiling tree per monitor, per workspace. Each monitor's
default split direction follows its **own** geometry — portrait monitors split
vertically, landscape monitors split horizontally.

## Where new windows open

`new-window-placement` (Preferences → general settings):

- **`pointer`** (default) — a new window tiles on the monitor with the pointer /
  active window.
- **`window-actual`** — a new window tiles on the monitor it actually opened on
  (respects app-restored geometry).

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

Hot-plugging a monitor is **not** handled by a dedicated signal: Forge listens to
`workareas-changed`, and there is no code path that adds or removes monitor nodes for
a display change. The tree recovers only incidentally — a new window that cannot find
its `mo{m}ws{n}` node triggers a full `reloadTree()`. If a layout looks wrong after a
display change, reload with `Super+Shift+r` and see
[troubleshooting.md](troubleshooting.md).
