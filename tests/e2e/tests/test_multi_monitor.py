"""Multi-monitor tiling E2E coverage (forge-a34.1).

Requires a dual-monitor session: run with FORGE_E2E_VIRTUAL_MONITORS=2 (e.g.
`make e2e-test-multimonitor`), which adds a second 1920x1080 virtual output in
start-user-session.sh. The test self-skips on single-monitor lanes so it is safe
in the default suite.
"""

import pytest
from framework.wait import wait_for

# Second virtual monitor starts at x=1920 (monitors are 1920 wide, side by side).
MONITOR_1_X = 1920


class TestMultiMonitorTiling:
    def test_window_retiles_across_monitors(self, shell_proxy, two_windows):
        """Moving a window to monitor 2 should re-tile each monitor independently."""
        if shell_proxy.get_monitor_count() < 2:
            pytest.skip("requires 2 virtual monitors (FORGE_E2E_VIRTUAL_MONITORS=2)")

        # Both windows start tiled (side by side) on the primary monitor.
        xs = [w.get("rect", {}).get("x", 0) for w in shell_proxy.get_windows()]
        assert xs and all(x < MONITOR_1_X for x in xs), (
            f"both windows should start on monitor 0, got xs={xs}"
        )

        # Move the focused window to the second monitor.
        shell_proxy.ensure_focus()
        assert shell_proxy.move_focused_window_to_monitor(1) == "ok"

        # Poll until BOTH monitors have re-tiled: one window each, each filling its
        # monitor (~full 1920 width minus gaps). The move and the monitor-0 re-tile
        # settle a beat apart, so the width check must be inside the wait predicate.
        def settled_split():
            wins = shell_proxy.get_windows()
            if len(wins) != 2:
                return None
            on0 = [w for w in wins if w.get("rect", {}).get("x", 0) < MONITOR_1_X]
            on1 = [w for w in wins if w.get("rect", {}).get("x", 0) >= MONITOR_1_X]
            if len(on0) != 1 or len(on1) != 1:
                return None
            if on0[0]["rect"]["width"] <= 1700 or on1[0]["rect"]["width"] <= 1700:
                return None
            return (on0[0], on1[0])

        on0, on1 = wait_for(
            settled_split,
            predicate=lambda r: r is not None,
            message="each monitor should hold one window filling it after the move",
        )
        # Proves Forge tiles the two monitors independently rather than sharing one.
        assert on0["rect"]["width"] > 1700 and on1["rect"]["width"] > 1700


class TestMonitorHotPlug:
    """Monitor hot-plug (workspaces-monitors G3/G4), on a real Mutter.

    Nothing in the extension reacted to a monitor arriving or leaving: the
    `mo{m}ws{n}` scaffold was only ever built by addWorkspace, which returns early
    once the workspace node exists, and there was no removeMonitor at all. So a
    window MOVED to a freshly plugged monitor was never re-homed and snapped back to
    its old monitor on the next render, and an unplugged monitor's nodes and their
    St.Bins stayed live in window_group.

    The fix connects Main.layoutManager::monitors-changed to reloadTree. This drives
    that signal the way Mutter itself does — a DisplayConfig change, which is a
    physical unplug/replug as far as the shell is concerned — and reads the tree and
    window_group back through the bridge. The unit fuzzer models it; this proves it.
    """

    @staticmethod
    def _on_monitor(win: dict, index: int) -> bool:
        x = win.get("rect", {}).get("x", 0)
        return (x >= MONITOR_1_X) if index == 1 else (x < MONITOR_1_X)

    def test_unplug_rehomes_windows_and_releases_the_scaffold(self, shell_proxy, two_windows):
        if shell_proxy.get_monitor_count() < 2:
            pytest.skip("requires 2 virtual monitors (FORGE_E2E_VIRTUAL_MONITORS=2)")

        # One window on each monitor, as a real dual-monitor session would hold.
        assert shell_proxy.activate_window_on_monitor(0) == "ok"
        assert shell_proxy.move_focused_window_to_monitor(1) == "ok"
        wait_for(
            lambda: [w for w in shell_proxy.get_windows() if self._on_monitor(w, 1)],
            predicate=lambda on1: len(on1) == 1,
            message="setup: one window should sit on monitor 1",
        )
        assert "mo1ws0" in shell_proxy.get_forge_monitor_nodes()
        actors_before = shell_proxy.get_window_group_child_count()

        try:
            shell_proxy.set_virtual_monitor_count(1)

            wait_for(
                shell_proxy.get_monitor_count,
                predicate=lambda n: n == 1,
                message="Mutter did not report the monitor as gone",
            )
            # The scaffold followed: no node for the vanished monitor remains.
            wait_for(
                shell_proxy.get_forge_monitor_nodes,
                predicate=lambda nodes: nodes and not any(n.startswith("mo1") for n in nodes),
                message="tree still holds mo1* nodes after the unplug",
            )
            # Both windows now tile on the surviving monitor, side by side.
            wins = wait_for(
                shell_proxy.get_windows,
                predicate=lambda ws: (
                    len(ws) == 2
                    and all(self._on_monitor(w, 0) for w in ws)
                    and all(w["rect"]["width"] < 1700 for w in ws)
                ),
                message="windows were not re-tiled onto the surviving monitor",
            )
            assert len(wins) == 2
            # forge-h6jc gauge: the unplugged monitor's bins were released, and the
            # rebuild did not stack a second set — the actor count went DOWN by
            # exactly the two bins that monitor owned (one per workspace).
            assert shell_proxy.get_window_group_child_count() < actors_before, (
                "window_group did not shrink after the unplug — the vanished "
                "monitor's scaffold bins are still parented"
            )
        finally:
            shell_proxy.set_virtual_monitor_count(2)
            wait_for(
                shell_proxy.get_monitor_count,
                predicate=lambda n: n == 2,
                message="Mutter did not bring the second monitor back",
            )

    def test_replug_adds_the_scaffold_so_a_moved_window_stays(self, shell_proxy, two_windows):
        if shell_proxy.get_monitor_count() < 2:
            pytest.skip("requires 2 virtual monitors (FORGE_E2E_VIRTUAL_MONITORS=2)")

        actors_at_two = shell_proxy.get_window_group_child_count()
        try:
            # Start from one monitor, then plug the second in.
            shell_proxy.set_virtual_monitor_count(1)
            wait_for(shell_proxy.get_monitor_count, predicate=lambda n: n == 1)
            wait_for(
                shell_proxy.get_forge_monitor_nodes,
                predicate=lambda nodes: nodes and not any(n.startswith("mo1") for n in nodes),
            )

            shell_proxy.set_virtual_monitor_count(2)
            wait_for(shell_proxy.get_monitor_count, predicate=lambda n: n == 2)
            # The G4 half: nodes for the NEW monitor exist for every workspace without
            # any window having been created on it.
            wait_for(
                shell_proxy.get_forge_monitor_nodes,
                predicate=lambda nodes: "mo1ws0" in nodes,
                message="no mo1ws0 node after the replug — hot-plug did not add the monitor",
            )

            # And a window moved there STAYS there — before the fix it snapped back
            # to monitor 0 on the next render because updateMetaWorkspaceMonitor
            # could not find a node to re-home it under.
            assert shell_proxy.activate_window_on_monitor(0) == "ok"
            assert shell_proxy.move_focused_window_to_monitor(1) == "ok"
            on1 = wait_for(
                lambda: [w for w in shell_proxy.get_windows() if self._on_monitor(w, 1)],
                predicate=lambda ws: len(ws) == 1 and ws[0]["rect"]["width"] > 1700,
                message="window moved to the replugged monitor did not stay and fill it",
            )
            assert len(on1) == 1
            # Two full cycles later the actor count is back where it started: the
            # rebuild released exactly what it recreated (forge-h6jc).
            assert shell_proxy.get_window_group_child_count() == actors_at_two
        finally:
            shell_proxy.set_virtual_monitor_count(2)


class TestMonocleScope:
    """workspaces-monitors G5: monocle acts on the FOCUSED window's monitor.

    It used to take monitorNodes[0] whatever the user was looking at, so invoking it
    from the second screen appeared to do nothing while quietly re-tabbing the first.
    i3/sway scope fullscreen per output; Forge now follows the focus — not the
    pointer, which is a keyboard action's poorest proxy for attention: with
    move-pointer-focus off it can be resting on another screen entirely. The pointer
    is parked on monitor 0 here on purpose, so a pointer-scoped implementation would
    fail this.
    """

    def test_monocle_collapses_the_focused_monitor_only(self, shell_proxy, four_windows):
        if shell_proxy.get_monitor_count() < 2:
            pytest.skip("requires 2 virtual monitors (FORGE_E2E_VIRTUAL_MONITORS=2)")

        # Two windows per monitor. Focus one that is still ON monitor 0 before each
        # move — ensure_focus() would happily re-pick the window just moved.
        for expected_on_1 in (1, 2):
            assert shell_proxy.activate_window_on_monitor(0) == "ok"
            assert shell_proxy.move_focused_window_to_monitor(1) == "ok"
            wait_for(
                lambda: [w for w in shell_proxy.get_windows() if w["rect"]["x"] >= MONITOR_1_X],
                predicate=lambda on1, n=expected_on_1: len(on1) == n,
                message=f"setup: expected {expected_on_1} window(s) on monitor 1",
            )

        # Baseline only once BOTH monitors have settled into two half-width windows:
        # monitor 0 is still re-tiling from three windows to two right after the
        # moves, and a baseline taken mid-re-tile makes the monocle look like it
        # touched a monitor it never did. (Seen: a 630-wide third-of-screen leftover
        # in the baseline, "changed" to 948 by the re-tile the monocle's own render
        # happened to flush.)
        def two_halves_each():
            ws = shell_proxy.get_windows()
            if len(ws) != 4:
                return None
            per = {0: [], 1: []}
            for w in ws:
                per[1 if w["rect"]["x"] >= MONITOR_1_X else 0].append(w["rect"]["width"])
            if any(len(v) != 2 for v in per.values()):
                return None
            if any(not (850 < width < 1000) for v in per.values() for width in v):
                return None
            return ws

        split = wait_for(
            two_halves_each,
            predicate=lambda r: r is not None,
            message="setup: expected two half-width windows on each monitor",
        )
        mon0_before = sorted(
            (w["rect"]["x"], w["rect"]["width"]) for w in split if w["rect"]["x"] < MONITOR_1_X
        )

        # Focus is on monitor 1 (the last moved window). Park the POINTER on 0.
        shell_proxy.simulate_mouse_move(200, 200)
        shell_proxy.invoke_forge_action({"name": "WorkspaceMonocleToggle"})

        def collapsed_on_1():
            ws = shell_proxy.get_windows()
            on1 = [w for w in ws if w["rect"]["x"] >= MONITOR_1_X]
            on0 = sorted(
                (w["rect"]["x"], w["rect"]["width"]) for w in ws if w["rect"]["x"] < MONITOR_1_X
            )
            if len(on1) != 2 or len(on0) != 2:
                return None
            # Monocle = one tabbed container: both windows share (~) one rect that
            # spans the monitor. Side by side they would each be ~half as wide.
            rects = [(w["rect"]["x"], w["rect"]["width"]) for w in on1]
            same_rect = abs(rects[0][0] - rects[1][0]) < 30 and abs(rects[0][1] - rects[1][1]) < 30
            wide = all(w > 1700 for _, w in rects)
            return (same_rect and wide, on0)

        collapsed, mon0_after = wait_for(
            collapsed_on_1,
            predicate=lambda r: r is not None and r[0],
            message="monitor 1 did not collapse into a monocle",
        )
        assert collapsed
        # ...and monitor 0 was left completely alone — still two side-by-side windows.
        assert mon0_after == mon0_before, (
            f"monocle touched monitor 0: {mon0_before} -> {mon0_after}"
        )

        # Toggle off restores monitor 1 to a split; monitor 0 still untouched.
        shell_proxy.invoke_forge_action({"name": "WorkspaceMonocleToggle"})
        wait_for(
            lambda: [w for w in shell_proxy.get_windows() if w["rect"]["x"] >= MONITOR_1_X],
            predicate=lambda on1: len(on1) == 2 and all(w["rect"]["width"] < 1700 for w in on1),
            message="monitor 1 did not return to a split after toggling monocle off",
        )
