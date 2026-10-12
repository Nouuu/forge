"""
Drag and Drop Tiling Tests for Forge (input-commands:G-002).

Drags TILED windows through the real grab handlers (_handleGrabOpBegin,
_handleMoving, _handleGrabOpEnd) via the bridge, since synthetic pointer input
fires no grab-op-begin headless (forge-v9o7). Results are asserted by window id.
"""

import time

import pytest
from framework.constants import Timing, Tolerance
from framework.wait import wait_for, wait_for_layout, wait_for_window_count
from framework.window_helper import WindowHelper


def _by_x(shell_proxy):
    return sorted(shell_proxy.get_windows(), key=lambda w: w["rect"]["x"])


def _assert_two_tiled_hsplit(shell_proxy, two_windows):
    wait_for_window_count(shell_proxy, 2)
    wm_class = two_windows[0].get("wmClass")
    assert shell_proxy.count_tiled_windows_of_class(wm_class) == 2
    wait_for_layout(shell_proxy, "HSPLIT")
    return wm_class


def _overlap(shell_proxy):
    windows = shell_proxy.get_windows()
    if len(windows) != 2:
        return None
    r1, r2 = (tuple(w["rect"][k] for k in ("x", "y", "width", "height")) for w in windows)
    return WindowHelper.calculate_overlap(r1, r2)


def _assert_settled(shell_proxy, wm_class):
    assert shell_proxy.count_tiled_windows_of_class(wm_class) == 2
    assert len(shell_proxy.get_windows()) == 2, "window count changed"
    wait_for(
        lambda: _overlap(shell_proxy),
        predicate=lambda o: o is not None and o <= Tolerance.OVERLAP,
        message=f"tiled windows overlap beyond {Tolerance.OVERLAP}px after the drop",
    )


@pytest.mark.drag
class TestDragDropBasic:
    """Drag one tiled window onto a zone of the other."""

    def test_drag_tiled_to_right_zone(self, shell_proxy, two_windows):
        wm_class = _assert_two_tiled_hsplit(shell_proxy, two_windows)
        left_id = _by_x(shell_proxy)[0]["id"]

        res = shell_proxy.fuzz_drag_path("leftmost", "rightmost", "right")
        assert isinstance(res, dict) and res.get("ok"), f"fuzzDragPath failed: {res}"

        wait_for(
            lambda: _by_x(shell_proxy)[-1]["id"],
            predicate=lambda wid: wid == left_id,
            message="right-zone drop did not move the left window after the right one",
        )
        _assert_settled(shell_proxy, wm_class)

    def test_drag_tiled_to_left_zone(self, shell_proxy, two_windows):
        wm_class = _assert_two_tiled_hsplit(shell_proxy, two_windows)
        right_id = _by_x(shell_proxy)[-1]["id"]

        res = shell_proxy.fuzz_drag_path("rightmost", "leftmost", "left")
        assert isinstance(res, dict) and res.get("ok"), f"fuzzDragPath failed: {res}"

        wait_for(
            lambda: _by_x(shell_proxy)[0]["id"],
            predicate=lambda wid: wid == right_id,
            message="left-zone drop did not move the right window before the left one",
        )
        _assert_settled(shell_proxy, wm_class)

    def test_drag_tiled_to_bottom_zone(self, shell_proxy, two_windows):
        wm_class = _assert_two_tiled_hsplit(shell_proxy, two_windows)
        windows = _by_x(shell_proxy)
        left_id, right_id = windows[0]["id"], windows[-1]["id"]

        res = shell_proxy.fuzz_drag_path("leftmost", "rightmost", "bottom")
        assert isinstance(res, dict) and res.get("ok"), f"fuzzDragPath failed: {res}"

        wait_for_layout(shell_proxy, "VSPLIT")
        by_id = {w["id"]: w for w in shell_proxy.get_windows()}
        assert by_id[left_id]["rect"]["y"] > by_id[right_id]["rect"]["y"], (
            "bottom-zone drop should place the dragged window below the target"
        )
        _assert_settled(shell_proxy, wm_class)


@pytest.mark.drag
class TestDragPreviewCleanup:
    """forge-63y (gh-529): no drag-preview overlay may survive a tab drag.

    The preview hint is an St.Bin cached on the dragged WINDOW node, created by
    _handleMoving while a GRAB_TILE drag hovers drop zones; _grabCleanup and
    _handleGrabOpEnd must release it on EVERY outcome. The drag runs through the
    real handlers (fuzz_drag_path) with the preview hint enabled.
    """

    def test_no_preview_hint_leak_after_tab_drag(
        self, shell_proxy, window_helper, restore_settings, two_windows
    ):
        restore_settings.set_tabbed_tiling_mode_enabled(True)
        restore_settings.set_preview_hint_enabled(True)
        time.sleep(Timing.SETTINGS_SETTLE)

        # Wrap the LEFT window into a single-child TABBED CON; the right one stays tiled.
        shell_proxy.invoke_forge_action(
            {"name": "LayoutTabbedToggle"}, focus_window="leftmost", also_activate=True
        )
        time.sleep(Timing.STACKED_LAYOUT_CHANGE)
        wait_for_layout(shell_proxy, "TABBED")
        assert len(shell_proxy.get_windows()) == 2, "expected two windows before drag"

        # A landed drop pulls the member out of its single-child TABBED CON, which is reaped.
        def count_cons(node):
            if not isinstance(node, dict):
                return 0
            own = 1 if node.get("nodeType") == "CON" else 0
            return own + sum(count_cons(c) for c in node.get("children") or [])

        cons_before = count_cons(shell_proxy.get_tree_structure())
        assert cons_before >= 1, "expected the TABBED CON in the tree before the drag"

        res = shell_proxy.fuzz_drag_path("leftmost", "rightmost", "right")
        assert isinstance(res, dict) and res.get("ok"), f"fuzzDragPath failed: {res}"
        assert res["trail"][-1]["hint"], f"no preview hint existed during the drag: {res}"

        hint_state = wait_for(
            shell_proxy.get_preview_hint_state,
            predicate=lambda h: h.get("count", -1) == 0 and h.get("visible", -1) == 0,
            message="Drag preview hint leaked after tab drag (gh-529 shape)",
        )
        assert hint_state.get("count") == 0

        wait_for(
            lambda: count_cons(shell_proxy.get_tree_structure()),
            predicate=lambda n: n < cons_before,
            message="the drop did not pull the member out of its TABBED CON",
        )
