# Forge Extension Testing Infrastructure

Unit tests for the Forge GNOME Shell extension using Vitest with mocked GNOME APIs.

## Quick Start

```bash
# Run all tests in Docker (preferred)
make unit-test-docker

# Run with coverage report
make unit-test-docker-coverage

# Watch mode for development
make unit-test-docker-watch

# Or run locally if Node.js environment matches
npm test
npm run test:coverage
```

## Structure

```
tests/
├── setup.js                     # Global test setup (mocks GNOME APIs)
├── mocks/
│   ├── gnome/                   # GNOME API mocks (Meta, Gio, GLib, etc.)
│   ├── metadata.js              # Stub for the generated lib/prefs/metadata.js
│   └── helpers/
│       ├── index.js             # Central export for all test helpers
│       ├── mockWindow.js        # Helper to create mock windows
│       ├── treeHelpers.js       # Tree navigation and creation helpers
│       ├── testFixtures.js      # Complete test fixture factories
│       └── fileStore.js         # In-memory Gio.File store for ConfigManager round trips
├── unit/                        # Unit tests by module
├── integration/                 # Full workflow tests
└── regression/                  # Bug regression tests
```

## Writing Tests

Tests use [Vitest](https://vitest.dev/). GNOME APIs are mocked automatically:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockWindow, createWindowManagerFixture } from '../../mocks/helpers/index.js';

describe('someFunction', () => {
  it('should do something', () => {
    const window = createMockWindow({ wm_class: 'Firefox' });
    // Test logic here
    expect(result).toBe(expected);
  });
});
```

### Test File Conventions

- Test files: `*.test.js`
- Location: `tests/unit/<module>/` or `tests/regression/`
- Naming: Match the file being tested (e.g., `utils.js` -> `utils.test.js`)

## Mock Infrastructure

The mocks simulate GNOME Shell APIs so tests run in Node.js without GNOME Shell:

| Mock | APIs |
|------|------|
| `Meta.js` | Window, Rectangle, Workspace, GrabOp |
| `Mtk.js` | Rectangle (the `Meta.js` class; `global.display.get_monitor_index_for_rect` rejects a plain object, as GJS does) |
| `Gio.js` | File, Settings |
| `GLib.js` | Path utilities, timeouts |
| `GObject.js` | Type system, signals |
| `Shell.js` | Shell integration |
| `St.js` | Shell toolkit (Bin, Widget, Label) |
| `Clutter.js` | Event handling |
| `Gtk.js`, `Adw.js`, `Gdk.js` | Prefs process widgets (see `tests/unit/prefs/gtk-mock.test.js` for the pinned GTK behaviours) |

Global mocks available: `global.display`, `global.get_pointer()`, `global.stage`.

`tests/setup.js` also mocks the prefs resource module (`gettext` returns its string,
`ExtensionPreferences` gives a mock `dir` and `getSettings`). `make metadata` generates
`lib/prefs/metadata.js` and git ignores it, so a fresh clone and `make unit-test-docker`
lack it. A `vi.mock` cannot stand in for it, since Vitest resolves the import first. Instead
`test.alias` in `vitest.config.js` points the `./metadata.js` import at
`tests/mocks/metadata.js`, for both coverage runs, and the suite never reads the generated
file.

The Gtk, Adw and Gdk mocks follow GTK where a prefs bug could hide: a property write
notifies synchronously and only on a real change, `set_text` with the same text emits no
`changed`, and a `SpinButton` clamps to its range.

### In-memory file store

`installFileStore(seed)` (`tests/mocks/helpers/fileStore.js`) spies on `Gio.File.prototype`
so the real `ConfigManager` reads and writes a map keyed by path. `seed` maps a path to its
text; the returned `files` is that map, and `failWrites()` makes every later write throw. A
path that does not end in `.json` reads as an existing directory. Call
`vi.restoreAllMocks()` in `afterEach`.

### Known mock quirks

- `St.Widget.destroy()` detaches the actor from its parent, as Clutter does, so a destroyed
  tab bar is no longer in `global.window_group`.
- `Meta.Window.allows_resize()` follows Mutter: it is false while the window is
  maximized on both axes or fullscreen. The `allows_resize` param stands for the size
  hints only, so a test that maximizes a window reads false, and a one-axis edge snap
  keeps the param's value.
- `Meta.Window` throws where Mutter aborts the shell, so a test that reaches such a state
  fails instead of passing on a forgiving double. The work-area calls and `move_to_monitor`
  throw for a window with no workspace. `get_work_area_current_monitor` and `move_to_monitor`
  also throw for no monitor or a monitor the display lacks, and `get_work_area_for_monitor`
  and `move_to_monitor` for an index outside the display's monitors. `maximize` and
  `set_maximize_flags` throw for a window with no actor when they maximize a new direction;
  `unmaximize` and `set_unmaximize_flags` throw for a maximized window with no monitor or a
  monitor the display lacks. The preconditions are class 8 in
  [hazards.md](../docs/dev/hazards.md). Fix the window or the code, never the double.
- A test window has the active workspace of the mock `global.workspace_manager` (install the
  mock globals first, as `createWindowManagerFixture` does) and monitor 0. Pass
  `workspace: null` or `monitor: -1` to remove one on purpose. `get_workspace()` answers the
  active workspace for a window on all workspaces, as Mutter does.
- `unmanage()` leaves the state `meta_window_unmanage` leaves, and emits no signal:
  `get_compositor_private()` returns null (any other window has an actor), the maximize flags
  clear, and the window has no workspace and no monitor.
- `Gio.Settings` has no schema. Its setters never refuse a value, and neither they nor
  `reset` emit `changed::<key>`: a test emits it by hand.
- `set_value`, `set_string` and `set_strv` return true. To test a refused write (a value
  outside its gschema range), stub the setter to return false.
- `GLib.Variant` coerces and throws like GJS for `b` and `u` only, except that a `u` of
  `undefined` or `NaN` throws where GJS gives 0. For `s` and `as` it keeps a non-string
  value where GJS throws, and `set_string` and `set_strv` accept any value.
- `get_default_value` returns the current value, and `reset` drops the stored one, so a
  getter then returns its type's zero (`false`, `0`, `""`, `[]`), not the gschema default.
- `bind` reads a number as a number and any other value as a boolean.
- `GLib.idle_add` runs its callback at once and returns 0, so no idle source stays
  pending. `timeout_add` never runs its callback and returns a random id.
- `Gio.File` stores no contents: `load_contents` returns empty bytes and `copy` or
  `replace_contents` keep nothing. A `ConfigManager` round trip uses the file store above;
  a test that reads back what was copied keeps its own store (see
  `bug-theming-config-g014-bak-survives-bumps.test.js`).

### Expanding Mocks

When tests need missing functionality, add it to the appropriate mock file. Keep mocks minimal - only implement what tests actually use.

## Coverage: two runs

`npm run test:coverage` runs Vitest twice, and fails when either run misses its
thresholds. CI runs the same script.

| Run | Config | Measures | Lines / branches / functions / statements |
|-----|--------|----------|-------------------------------------------|
| Global | `vitest.config.js` | `lib/**/*.js`, `extension.js`, `prefs.js`, from every test | 90 / 85 / 90 / 90 |
| Prefs | `vitest.prefs.config.js` | `lib/prefs/**/*.js`, from `tests/unit/prefs/` and `tests/regression/` only | 87 / 89 / 84 / 87 |

Vitest 2.1.9 checks every file of the coverage map against the global thresholds, so
`lib/prefs` gets its own run and its own floor. The prefs report lands in
`coverage/prefs/`. Both floors sit below the measured values: raise them as coverage
grows, never lower them to make a red build pass.

Run one alone:

```bash
npx vitest run --coverage                                   # global
npx vitest run --coverage --config vitest.prefs.config.js   # prefs
```

Excluded from the reports, besides the test files and `tests/mocks/`:

- **`lib/prefs/**`** from the global run, because the prefs run measures it.
- **`lib/prefs/metadata.js`** from the prefs run: `make metadata` generates it.
- **`lib/extension/extension-theme-manager.js`** from the global run: UI-only stylesheet
  loading into the St theme.

Everything else is expected to be covered. `keybindings.js` in particular IS tested
(`tests/unit/keybindings/`): its drag-modifier and dispatch logic is real logic; only the
`Main.wm` registration glue is inherently untestable.

## Troubleshooting

**Import errors** (`Cannot find module 'gi://Meta'`):
- Check that `tests/setup.js` is configured in `vitest.config.js`
- Ensure mocks are exported in `tests/mocks/gnome/index.js`

**Mock behavior doesn't match real API**:
- Update the mock in `tests/mocks/gnome/` to match actual behavior

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [GNOME JavaScript (GJS) API](https://gjs-docs.gnome.org/)
