# Portable configuration

Forge can mirror your settings and keybindings to plain JSON files so you can back
them up, version-control them, or copy them to another machine.

## Where config lives

```
~/.config/forge/config/
├── settings.json       # mirror of Forge GSettings (appearance, behavior, …)
├── keybindings.json    # mirror of keybindings
└── windows.json        # float/tile window rules (see rules.md)
```

GSettings remains the live source of truth; these files are an import/export layer.

Three keys have no control in a shipped build: `tiling-mode-enabled` (quick settings toggle or `Super+w`), `log-level` and `logging-enabled` (debug builds only, no effect in a shipped build).

## Export / import

In **Preferences → Portability**:

- **Open config directory** — opens the folder above in your file manager.
- **Export current settings** — writes your current GSettings to `settings.json` /
  `keybindings.json` (with "Last export" timestamp).
- **Import** — reads those files back into GSettings ("Last import" timestamp).

Import applies every value GSettings accepts and skips one it refuses, such as a
`window-gap-size` above 32. The toast then says "Configuration partially imported";
"Import failed" means nothing was applied. With logging on in a debug build, each
skipped key is logged as `Import rejected <key>`.

Import also skips a value of the wrong type, and logs it the same way. A number
setting needs a whole number from 0 up, a switch needs `true` or `false`, a text
setting needs text, and a shortcut needs a list of texts. So the text `"false"` for a
switch is skipped, not applied. The keys after a skipped one are still applied.

On startup, Forge's config sync imports any present files automatically, so dropping
a known-good `settings.json`/`keybindings.json` into the config dir and restarting
applies it. `windows.json` is reloaded live with **`Super+Shift+r`**.

## Moving config between machines

1. On the source machine: **Export current settings**.
2. Copy `~/.config/forge/config/*.json` to the same path on the target.
3. On the target: **Import** (or just restart GNOME Shell — sync imports on enable).

Because the files are plain JSON, they diff cleanly and are safe to keep in a
dotfiles repo.
