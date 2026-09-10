"""
Move-pointer-with-focus tests for Forge.

`move-pointer-focus-enabled` warps the pointer into the newly focused window.
The warp goes through Clutter's seat lookup, which is the one Clutter API Forge
calls that has no documented version cutoff — Shell exposes it as
`global.backend.get_default_seat()`, Clutter as
`Clutter.get_default_backend().get_default_seat()`, and each has been the current
one at different points. `Compat.getDefaultSeat()` probes both and degrades to
null rather than throwing.

Degrading silently is the trap: the caller sits inside Forge's focus handler, so
before the guard a failure there broke focus on EVERY window change, and after it
the feature would just stop working with nothing logged. Unit tests can only prove
the guard; they cannot prove the accessor still exists. This file is what exercises
it against a real shell — and it runs on the whole GNOME 45..50 matrix, which is
where a drifting accessor would actually show up.
"""

from framework.wait import wait_for


def _focused_rect(shell_proxy) -> dict:
    """Rect of the currently focused window.

    Keyed on isFocused, not on wmClass: the two_windows fixture launches two
    instances of the SAME application, so a wmClass lookup returns whichever one
    comes first and silently measures the wrong window.
    """
    for w in shell_proxy.get_windows():
        if w.get("isFocused"):
            return w["rect"]
    raise AssertionError("no focused window reported by the bridge")


def _center(rect: dict) -> tuple:
    return rect["x"] + rect["width"] // 2, rect["y"] + rect["height"] // 2


class TestMovePointerWithFocus:
    """Pointer follows keyboard focus when the setting is on."""

    def test_pointer_warps_into_the_newly_focused_window(
        self, shell_proxy, input_sim, window_helper, restore_settings, dispatch_mode, two_windows
    ):
        """Focusing the other window moves the pointer inside it."""
        if dispatch_mode != "dbus":
            # Synthetic super+h/l is unreliable under Mutter's VirtualInputDevice
            # (tile-snap latch, forge-er8), and this assertion needs the focus move
            # to actually happen. Same carve-out as test_focus_navigation.
            return

        restore_settings.set("move-pointer-focus-enabled", True)

        # Seed at the left edge so the next move is an interior one that must change
        # the focused window (Forge focus-nav stays at the edge, it never wraps).
        input_sim.focus_left()
        left_id = window_helper.get_focused_id()
        left_rect = _focused_rect(shell_proxy)

        # Park the pointer in the LEFT window so a warp is observable as movement.
        shell_proxy.simulate_mouse_move(*_center(left_rect))

        input_sim.focus_right()
        window_helper.assert_focus_moved(left_id)

        target = _focused_rect(shell_proxy)
        tx, ty = target["x"], target["y"]
        tw, th = target["width"], target["height"]

        def pointer_inside_target():
            px, py = shell_proxy.get_pointer()
            return tx <= px <= tx + tw and ty <= py <= ty + th

        wait_for(
            pointer_inside_target,
            predicate=lambda inside: inside,
            message=(
                "pointer did not follow focus into the newly focused window — "
                "the Clutter seat lookup degraded to null or the warp was refused"
            ),
        )

    def test_pointer_stays_put_when_the_setting_is_off(
        self, shell_proxy, input_sim, window_helper, restore_settings, dispatch_mode, two_windows
    ):
        """With the setting off, focus moves but the pointer does not.

        Control for the test above: without it, a pointer that happens to already
        sit in the target window would satisfy the assertion with no warp at all.
        """
        if dispatch_mode != "dbus":
            return

        restore_settings.set("move-pointer-focus-enabled", False)

        input_sim.focus_left()
        left_id = window_helper.get_focused_id()
        parked = _center(_focused_rect(shell_proxy))
        shell_proxy.simulate_mouse_move(*parked)

        input_sim.focus_right()
        window_helper.assert_focus_moved(left_id)

        px, py = shell_proxy.get_pointer()
        assert (px, py) == parked, f"pointer moved to ({px},{py}) with the setting off"
