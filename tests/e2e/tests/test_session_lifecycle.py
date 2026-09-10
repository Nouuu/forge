"""
Session lifecycle tests for Forge: the lock screen and an extension disable/enable.

Two different paths, and the distinction matters:

- The LOCK SCREEN (session mode "unlock-dialog") leaves the window manager alone on
  purpose: extension.js only drops the keybindings and the indicator, so the tree
  survives in memory and the layout is intact on unlock (GNOME 45 session-mode review
  guideline). Bug #354 pinned the idempotence of that in unit tests; this proves it on
  a real shell, where Main.sessionMode drives the same 'updated' signal the real lock
  screen does.

- DISABLE/ENABLE through the extension manager is the ONLY path that runs
  WindowManager.disable(). That is where a throw is an outage — GNOME marks the
  extension ERROR and will not load it again without the user — and where the teardown
  fuzzer found windowsAllWorkspaces sorting a finalized wrapper. The unit fuzzer pins
  the guards; this proves the whole cycle settles to ENABLED with an empty error on a
  real shell, with a window closed right before the teardown so a not-yet-pruned
  wrapper is on the path.
"""

import time

from framework.constants import Timing
from framework.wait import wait_for, wait_for_window_count


def _indicator_count(shell_proxy) -> int:
    # The Quick Settings indicator is (re)created per 'user' session update; #354 was
    # a duplicate on every unlock.
    return int(
        shell_proxy.eval(
            "(function(){ const items = Main.panel.statusArea.quickSettings"
            "._indicators.get_children(); return items.filter(i => "
            "i.constructor?.name === 'FeatureIndicator').length; })()"
        )
    )


def _tracked_window_count(shell_proxy) -> int:
    """WINDOW nodes in Forge's tree — proves the manager is tracking, not just that
    the windows exist."""

    def count(node) -> int:
        if not isinstance(node, dict):
            return 0
        n = 1 if node.get("nodeType") == "WINDOW" else 0
        return n + sum(count(c) for c in node.get("children") or [])

    return count(shell_proxy.get_tree_structure())


def _rects(shell_proxy) -> list:
    return sorted(
        (w["rect"]["x"], w["rect"]["y"], w["rect"]["width"], w["rect"]["height"])
        for w in shell_proxy.get_windows()
    )


class TestLockScreen:
    def test_layout_and_indicator_survive_a_lock_unlock_cycle(self, shell_proxy, two_windows):
        """Lock keeps the tree; unlock brings back exactly one indicator."""
        before = _rects(shell_proxy)
        assert len(before) == 2

        assert shell_proxy.push_session_mode("unlock-dialog") == "unlock-dialog"
        time.sleep(Timing.LAYOUT_CHANGE)
        assert _indicator_count(shell_proxy) == 0, "indicator still shown on the lock screen"

        assert shell_proxy.pop_session_mode("unlock-dialog") == "user"
        time.sleep(Timing.LAYOUT_CHANGE)

        assert _rects(shell_proxy) == before, "window layout changed across lock/unlock"
        assert _indicator_count(shell_proxy) == 1, "indicator not recreated exactly once"

        # A second cycle must not stack a second indicator (#354).
        shell_proxy.push_session_mode("unlock-dialog")
        time.sleep(Timing.LAYOUT_CHANGE)
        shell_proxy.pop_session_mode("unlock-dialog")
        time.sleep(Timing.LAYOUT_CHANGE)
        assert _indicator_count(shell_proxy) == 1, "second unlock stacked a duplicate indicator"


class TestExtensionCycle:
    def test_disable_enable_settles_and_tiling_resumes(
        self, shell_proxy, window_helper, two_windows
    ):
        """A clean cycle: ENABLED, no error, and a new window tiles afterwards."""
        state = shell_proxy.cycle_extension()
        assert state == {"state": 1, "error": ""}, f"extension did not come back clean: {state}"

        # The tree was REBUILT, not merely left as it was: both windows are tracked
        # again as WINDOW nodes. (Their rects alone would not prove that — they were
        # already tiled before the cycle and would keep those rects if the new
        # WindowManager tracked nothing.)
        wait_for(
            lambda: _tracked_window_count(shell_proxy),
            predicate=lambda n: n == 2,
            message="windows were not re-tracked into the tree after the cycle",
        )
        wins = wait_for_window_count(shell_proxy, 2)
        widths = sorted(w["rect"]["width"] for w in wins)
        assert widths[-1] < 1700, f"windows not tiled after the cycle: {widths}"

    def test_cycle_right_after_a_close_does_not_error(
        self, shell_proxy, window_helper, two_windows
    ):
        """Close a window and tear down immediately — the not-yet-pruned wrapper is on
        the teardown path (windowsAllWorkspaces + _removeSignals). The teardown must
        not throw, or the extension is left in ERROR."""
        assert shell_proxy.close_one_window_any_workspace() >= 0
        # No wait on purpose: the race being modelled is "close, then disable before
        # windowDestroy has pruned the node".
        state = shell_proxy.cycle_extension()

        assert state["error"] == "", f"teardown threw after a fast close: {state['error']}"
        assert state["state"] == 1

        # enable() reloads on an idle and the render is another idle behind it, so the
        # surviving window still shows its half-width rect for a beat: wait on the
        # WIDTH, not just on the count.
        wait_for_window_count(shell_proxy, 1)
        wait_for(
            lambda: max(w["rect"]["width"] for w in shell_proxy.get_windows()),
            predicate=lambda wmax: wmax > 1700,
            message="surviving window did not re-tile to fill after the cycle",
        )
