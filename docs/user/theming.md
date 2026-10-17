# Theming & appearance

Most appearance options — border size/color/radius, gaps, margins, tab decoration —
are in **Preferences → Appearance**, no CSS required. For finer control you can
override Forge's stylesheet.

## Preferences

Appearance settings (focus-hint borders, split borders, gaps, screen-edge margins,
tab margins) update live. When you change a focus-hint **color or size**, it
propagates everywhere that hint is drawn: the tiled/stacked/tabbed window borders,
the drag **preview hints**, and the overview / workspace-thumbnail hints. Each hint
group has a **Reset** to restore the gschema default.

## Gaps

- `window-gap-size` (default 4, 0 to 32): space between tiled windows; adjustable live
  with the gap inc/dec shortcuts (`window-gap-size-increment`, 0 to 32, is the step).
- `window-gap-hidden-on-single` — hide the gap when a workspace has one window.
- `window-margin-{top,bottom,left,right}` (0 to 100): reserve screen-edge space for
  panels/docks.

## Custom CSS

Forge loads a user stylesheet from:

```
~/.config/forge/stylesheet/forge/stylesheet.css
```

It's seeded from the bundled default on first run.
An upgrade that bumps the stylesheet version replaces your copy with the new default on
the next start. Your previous file is kept next to it as `stylesheet.css.<N>.bak`, where
`<N>` is the version it replaces, so older backups are kept.

**A hand-edited stylesheet needs a shell restart** (`Alt+F2` → `r` on X11, or log
out/in on Wayland). `Super+Shift+r` reloads window rules and portable config only —
it does not touch the stylesheet. Changing a colour from **Preferences → Appearance**
does reload it live, because prefs writes the `css-updated` key the extension
watches.

If Forge cannot read your stylesheet (a file without read permission for you), the
shell loads the bundled default stylesheet instead. Preferences shows the bundled default
colours and a warning on the Appearance page, and does not save colour changes, so your
file is never overwritten. Make the file readable again, reopen Preferences, then restart
the shell (or log out and back in on Wayland).

Selectors Forge exposes (see the bundled `stylesheet.css` for the full set):

| Selector | What it styles |
| --- | --- |
| `.window-tiled-border` | Border of a tiled window |
| `.window-split-border` | Split-container border |
| `.window-stacked-border` / `.window-tabbed-border` | Stacked / tabbed container border |
| `.window-floated-border` | Floating-window border |
| `.window-tabbed-tab`, `.window-tabbed-tab-active`, `.window-tabbed-tab-icon`, `.window-tabbed-tab-close` | Tab strip elements |
| `.window-tilepreview-tiled` / `-stacked` / `-tabbed` / `-swap` | Drag/drop preview hints |
| `.tiled`, `.split`, `.stacked`, `.tabbed`, `.floated` | Palette classes (color/opacity) |
| `.forge-cheatsheet`, `.forge-cheatsheet-close`, `.forge-cheatsheet-category`, `.forge-cheatsheet-row`, `.forge-cheatsheet-key`, `.forge-cheatsheet-desc` | Keybinding cheatsheet overlay (`Super+Shift+/`) |

Border width, color, radius, and opacity are plain CSS properties; colors accept
`rgba(...)` or hex.

> Advanced: the CSS parser and `ThemeManagerBase` API live in `lib/css/` and
> `lib/shared/theme.js` (see [dev/rendering.md](../dev/rendering.md)).
