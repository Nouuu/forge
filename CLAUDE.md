# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Forge is a GNOME Shell extension providing i3/sway-style tiling window management. It supports GNOME 45+ on both X11 and Wayland, featuring tree-based tiling with horizontal/vertical split containers, stacked/tabbed layouts, vim-like keybindings, drag-and-drop tiling, and multi-monitor support.

## Build & Development Commands

Run `make help` for the full target list; `npm install` first (needs Node.js 20+ and gettext).

- **`make dev`** installs a debug build locally; **`make prod`** does a full install + enable + shell restart.
- **`make test`** (nested Wayland, no restart) / **`make test-x`** (X11) for manual in-shell testing.
- **`npm test`** runs the unit suite (mocked GNOME APIs); **`make unit-test-docker`** and **`make e2e-test`** are the canonical Docker environments.
- **`npm run format`** / **`npm run lint`** — Prettier; **`npm run lint:src`** / **`npm run lint:e2e`** — ESLint; **`npm run typecheck`** — `tsc --noEmit`. The husky pre-commit hook (`lint-staged`) runs all of these plus `vitest related` and `ruff`.

## Architecture

Forge models each workspace's windows as an i3/sway-style **tree** and reconciles it onto the screen. Entry points: `extension.js` (lifecycle) and `prefs.js` (GTK4/Adwaita preferences).

The tiling logic lives in `lib/extension/` (tree model, window manager, command dispatch, focus/decoration, keybindings, monitors/workspaces); shared config/sync/theme code is in `lib/shared/`, and the CSS parser used by the theme engine is in `lib/css/`. The Prefs UI (`lib/prefs/`) is GTK4/Adwaita and not unit-tested.

See **[docs/dev/](docs/dev/)** for the detailed reference: [architecture.md](docs/dev/architecture.md) (lifecycle, tree model, command dispatch, signal/cleanup discipline, config sources), [rendering.md](docs/dev/rendering.md) (render/placement pipeline, reload triggers, floating subsystem, theme engine), [compat.md](docs/dev/compat.md) (Mutter API drift + shim recipe), [hazards.md](docs/dev/hazards.md) (bug-class → guardrail catalog), [translations.md](docs/dev/translations.md) (gettext/i18n setup).

## Testing Infrastructure

- **Unit tests** — Vitest with mocked GNOME APIs (`tests/mocks/`); run `npm test`, or `make unit-test-docker` for the canonical Docker environment. Structure, mock helpers, and how to write non-vacuous tests: **[tests/README.md](tests/README.md)**.
- **E2E tests** — real GNOME Shell in self-contained Fedora Docker containers (D-Bus `Shell.Eval` + xdotool); run `make e2e-test` (defaults to GNOME 48 / Fedora 42), `make e2e-test GNOME_VERSION=<n>`, or `make e2e-test-all`. Supported range is GNOME 45–50; see `tests/e2e/gnome-versions.json`. Full infrastructure docs: **[tests/e2e/README.md](tests/e2e/README.md)**.

## Key Concepts

- **Tiling tree**: Windows are organized in a tree structure similar to i3/sway. Containers can split horizontally or vertically, or display children in stacked/tabbed mode.

- **Window modes**: TILE (managed by tree), FLOAT (unmanaged), GRAB_TILE (being dragged), DEFAULT

- **Session modes**: Extension disables keybindings on lock screen but keeps tree in memory to preserve layout

- **GObject Classes**: All core classes extend GObject with `static { GObject.registerClass(this); }` pattern.

- **Signal Connections**: Track signal IDs for proper cleanup in disable().

## Configuration Files

- GSettings schemas: `org.gnome.shell.extensions.forge` and `org.gnome.shell.extensions.forge.keybindings`
- Window overrides: `~/.config/forge/config/windows.json`
- Stylesheet overrides: `~/.config/forge/stylesheet/forge/stylesheet.css`

## Code Style

- Prettier with 2-space indentation, 100-char line width; run `npm run format` before committing
- ESLint (`eslint.config.js`) lints `lib/`, `extension.js`, `prefs.js`, and the e2e framework. Three custom repo rules in `eslint-rules/` (`no-raw-maximize-api`, `no-unguarded-window-deref`, `no-untracked-connect`) enforce the bug-class guardrails catalogued in [docs/dev/hazards.md](docs/dev/hazards.md) and run as blocking errors
- Husky pre-commit hooks (`lint-staged`) enforce prettier, ESLint, `vitest related`, and `ruff` (Python e2e helpers)

## Branches

- `main` - GNOME 45+ (current development)
- `legacy`/`gnome-3-36` - GNOME 3.36 support (feature-frozen)


## Issue Tracking

This fork does **not** run a tracker inside the repository. Upstream
(`jcrussell/forge`) uses **bd (beads)** — a Dolt-backed issue store synced over
`refs/dolt/data` — but none of its data is distributed: `.beads/` ships only hooks and
config (`dolt/` and `issues.jsonl` are gitignored), and this fork's remote carries no
`refs/dolt/*`. The `forge-xxxx` identifiers throughout the commit history, code
comments and regression-test headers are therefore upstream references that cannot be
resolved locally — treat them as stable labels, not as queryable tickets.

### Rules

- Track follow-up work in this fork's GitHub issues, not in files. Do not add markdown
  TODO lists to the repo.
- `TodoWrite` is fine for within-session task lists; it is not persistence.
- Durable knowledge goes to the session memory directory, not to a `MEMORY.md` in the
  repo.
- When fixing a defect, keep the existing traceability convention: reference the issue
  id in the commit subject, in a comment at the fix site, and in the header of the
  pinned `tests/regression/bug-<id>-<slug>.test.js`.

> Re-adopting beads is a deliberate choice, not a default: it would need `bd` installed
> and a fresh local database. Only worth it if this fork takes on enough in-flight work
> to justify a tracker, or starts upstreaming and needs to speak the maintainer's ids.

## Session Completion

**When ending a work session**, complete the steps below, then stop and report.

1. **Run quality gates** (if code changed) - tests, linters, type check, build
2. **Note remaining work** - anything needing follow-up goes to this fork's GitHub issues
3. **Show the state** - `git status` and `git diff --stat`, so the change set is visible
4. **Clean up** - clear stashes, remove scratch artifacts
5. **Hand off** - what changed, what was verified, what is still open

**Committing and pushing are the maintainer's call.** Do not commit or push unless
asked explicitly, in this session, for this change. Prepare the work and report it;
never push on your own initiative, and never treat an earlier approval as covering a
later change.
