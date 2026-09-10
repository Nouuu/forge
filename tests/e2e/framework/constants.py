"""
Constants for E2E testing.

Centralizes timing values, tolerances, and configuration to avoid
magic numbers scattered throughout the codebase.
"""

import os


def _timeout_scale() -> float:
    """Multiplier for wait CEILINGS, from FORGE_E2E_TIMEOUT_SCALE (default 1).

    GitHub runners finish the suite ~40% slower than a workstation (≈690 s vs
    ≈480 s), and three different tests flaked there on three different GNOME
    legs in one day — every one a WaitTimeoutError on a condition that does
    become true, just later. Scaling only the ceilings (Timeout.*) gives a slow
    runner room without slowing anything: a wait returns the moment its
    predicate holds, so a fast machine is unaffected, and a genuine regression —
    a predicate that never holds — still fails, only at 2× the deadline.

    The fixed settles in Timing.* are deliberately NOT scaled: those are sleeps,
    and scaling them would slow every test everywhere.
    """
    raw = os.environ.get("FORGE_E2E_TIMEOUT_SCALE", "1")
    try:
        scale = float(raw)
    except ValueError as exc:
        raise ValueError(f"FORGE_E2E_TIMEOUT_SCALE must be a number, got {raw!r}") from exc
    if scale < 1:
        raise ValueError(f"FORGE_E2E_TIMEOUT_SCALE must be >= 1, got {scale}")
    return scale


TIMEOUT_SCALE = _timeout_scale()


class Timing:
    """Timing constants for test synchronization (in seconds)."""

    # Window operations
    WINDOW_SETTLE = 0.5  # Time for window layout to stabilize
    WINDOW_LAUNCH = 10.0  # Max time to wait for window to appear
    WINDOW_CLOSE = 0.3  # Time after closing a window

    # Keyboard/input
    KEY_DELAY_MS = 50  # Delay between key presses (milliseconds)
    KEYBIND_RESPONSE = 0.3  # Time for keybinding to take effect
    KEY_AFTER_PRESS = 0.1  # Brief pause after key press

    # Layout changes
    LAYOUT_CHANGE = 0.5  # Time for layout change to complete
    STACKED_LAYOUT_CHANGE = (
        3.0  # Stacked/tabbed layouts need more time (heavy rendering under Xvfb)
    )
    FOCUS_CHANGE = 0.2  # Time for focus change

    # Settings and resize
    SETTINGS_SETTLE = 0.8  # Time for GSettings changes to propagate
    RESIZE_SETTLE = 0.3  # Time for resize keybinding to take effect
    WORKSPACE_SWITCH = 0.5  # Time for workspace switch animation

    # Polling
    POLL_INTERVAL = 0.1  # Default polling interval
    POLL_INTERVAL_WINDOW = 0.2  # Polling interval for window operations

    # Shell startup
    SHELL_READY_TIMEOUT = 60  # Max time to wait for GNOME Shell
    EXTENSION_INIT = 5  # Time for extensions to initialize
    STABILITY_TIME = 0.5  # Time value must be stable


class Tolerance:
    """Pixel tolerance values for assertions."""

    POSITION = 10  # Window position tolerance
    SIZE = 20  # Window size tolerance (accounts for default gaps)
    OVERLAP = 100  # Max allowed overlap between tiled windows
    CENTERING = 100  # Tolerance for centered windows
    ALIGNMENT = 20  # Tolerance for window alignment
    FILL_RATIO = 0.85  # Min ratio of workspace filled by windows
    RESIZE_MIN_DELTA = 10  # Minimum pixel change expected from resize
    SNAP_RATIO = 0.05  # Tolerance for snap layout width ratio (5%)


class Timeout:
    """Timeout values for various operations (in seconds).

    These are CEILINGS on how long a wait may poll before declaring failure,
    scaled by FORGE_E2E_TIMEOUT_SCALE (see _timeout_scale). A wait returns as
    soon as its predicate holds, so raising a ceiling costs nothing on a
    machine that meets it.
    """

    DEFAULT = 5.0 * TIMEOUT_SCALE  # Default timeout for wait operations
    WINDOW = 10.0 * TIMEOUT_SCALE  # Timeout for window operations
    SHELL = 60.0 * TIMEOUT_SCALE  # Timeout for shell startup
    LAYOUT = 5.0 * TIMEOUT_SCALE  # Timeout for layout operations


class RetryConfig:
    """Retry configuration for flaky operations."""

    MAX_ATTEMPTS = 3
    DELAY = 0.5
    WINDOW_CLOSE_ATTEMPTS = 10


# Forge extension constants
FORGE_UUID = "forge@jmmaranan.com"
# Use --new-window to ensure multiple instances can be launched
DEFAULT_TEST_APP = "gnome-text-editor"
DEFAULT_TEST_APP_ARGS = ["--new-window"]

# App palette for the fuzzer's input-diversity angle (forge-v9o7 family / Angle 2). ONLY apps
# reliably present in the e2e image may live here — docker/Dockerfile.e2e installs exactly two
# GUI apps: gnome-text-editor and zenity (no calculator/terminal). gnome-text-editor is the
# dominant default: it TILES and survives the Mutter-50 GApplication register race. zenity is a
# GtkMessageDialog (`--info`), so Forge's _isDialogLike exclusion keeps it OUT of the tile tree
# (proven in test_dialog_windows.py) — it contributes a DISTINCT wm_class plus a dialog/transient
# + fixed-small-min-size probe (the tile-reject / late-wm_class / float-specificity paths) WITHOUT
# ever entering the tiled-overlap oracle (an excluded window is never a tiled node, so it
# cannot false-positive the geometry check). Each entry maps the app to its launch args and a
# spawn weight. NO --timeout on zenity: the fuzzer owns the window's lifetime (its close step
# deletes it), so an auto-dismissing dialog would desync replay. Weighting is heavily
# editor-favoured: spawns cost ~10s and only the editor builds tree structure, so zenity stays an
# occasional probe rather than the norm. A second TILED class is NOT available in the container,
# so true tiled-class diversity is infra-limited (see report) — zenity is the reachable probe.
APP_PALETTE = {
    DEFAULT_TEST_APP: {"args": DEFAULT_TEST_APP_ARGS, "weight": 9},
    "zenity": {"args": ["--info", "--text=forge-fuzz", "--no-wrap"], "weight": 1},
}
