# Window rules

Rules tell Forge to **float** a window that would normally tile (dialogs, launchers,
games), or to **force-tile** one that would normally float. Forge ships ~40 default
rules for common apps (JetBrains splashes, Conky, ddterm, GNOME setup dialogs, …).

## Two ways to add a rule

- **Preferences → Windows** — "Add Floating Window": type the window class (and
  optionally a title); Forge saves the rule. This is the easy path.
- **Toggle shortcuts** — the per-window and per-class float toggles (see
  [keybindings](keybindings.md#common-defaults)) write a rule for you.

You can also edit the file directly.

## The file: `~/.config/forge/config/windows.json`

```json
{
  "overrides": [
    { "wmClass": "Conky", "mode": "float" },
    { "wmClass": "jetbrains-idea", "wmTitle": "splash", "mode": "float" },
    { "wmClass": "Calculator", "mode": "tile" }
  ]
}
```

Each override:

| Field | Required | Meaning |
| --- | --- | --- |
| `wmClass` | no* | Window class to match. **Exact** match (case-sensitive); comma-separates a list of exact classes. |
| `wmTitle` | no* | Window title. Case-insensitive substring; `!` prefix negates; comma-separates alternatives. |
| `mode` | yes | `float` = keep out of tiling; `tile` = force into tiling. |
| `wmId` | — | Runtime-only (written by the per-window toggle); don't set by hand. |

\* Give at least one of `wmClass` or `wmTitle`. A title-only rule is valid — the
bundled config ships one (`{"wmTitle": "Picture-in-Picture", "mode": "float"}`) to
float browser PIP windows whatever their class.

`wmTitle` matches the same way in both modes. A single space (`" "`) is the one
exception: it means "the window whose title is literally one space", and is compared
for equality rather than as a substring.

After hand-editing, reload with **`Super+Shift+r`**.

## Finding a window's class

```bash
xprop WM_CLASS      # then click the window
```

Use the **second** string it prints (the class), or read it from GNOME Looking
Glass (`Alt+F2` → `lg`).

> Precedence: a `tile` override for a window/class wins over float-by-type and float
> rules, so you can force-tile one window of an otherwise-floating class. A
> per-window toggle never removes a class-wide rule.
