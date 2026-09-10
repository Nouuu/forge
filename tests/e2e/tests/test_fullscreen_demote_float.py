"""forge-zo4 (gh-460): always-on-top floats demote under a fullscreen window.

When a window goes fullscreen, Forge-pinned always-on-top floats on the same
monitor must drop below it instead of rendering over the fullscreen surface.
_reconcileFullscreenFloatDemotion() unmake_above()'s them while a fullscreen
window is present and re-pins them once it clears.

This verifies the real in-fullscreen-changed -> reconcile path end-to-end AND
the previously-unverified Mutter assumption that unmake_above() actually lowers
the float BELOW the fullscreen window in the stacking order.
"""

import time

from framework.constants import Timing
from framework.wait import wait_for

FLOAT_TOGGLE = {
    "name": "FloatToggle",
    "mode": "float",
    "x": "center",
    "y": "center",
    "width": 0.65,
    "height": 0.75,
}

_NORMAL_WINS = (
    "let ws=global.workspace_manager.get_active_workspace();"
    "let wins=global.display.list_all_windows().filter(w=>"
    " w.get_window_type()===Meta.WindowType.NORMAL && w.get_workspace()===ws);"
)


def _count_above_normal(shell_proxy) -> int:
    return shell_proxy.eval(
        "(function(){" + _NORMAL_WINS + "return wins.filter(w=>w.is_above()).length;})();"
    )


def _fullscreen_a_tiled_window(shell_proxy) -> str:
    return shell_proxy.eval(
        "(function(){" + _NORMAL_WINS + "let t=wins.find(w=>!w.is_above());"
        "if(!t) return 'none';t.make_fullscreen();return 'ok';})();"
    )


def _unfullscreen_all(shell_proxy) -> str:
    return shell_proxy.eval(
        "(function(){global.display.list_all_windows().forEach(w=>{"
        "if(w.is_fullscreen()) w.unmake_fullscreen();});return 'ok';})();"
    )


def _fullscreen_stacked_above_float(shell_proxy) -> str:
    return shell_proxy.eval(
        "(function(){" + _NORMAL_WINS + "let fs=wins.find(w=>w.is_fullscreen());"
        "let fl=wins.find(w=>!w.is_fullscreen());"
        "if(!fs||!fl) return 'missing';"
        "let stack=global.display.sort_windows_by_stacking(wins);"
        "return stack.indexOf(fs) > stack.indexOf(fl) ? 'fs-above' : 'fs-below';})();"
    )


class TestFullscreenDemoteFloat:
    def test_float_demotes_under_fullscreen_and_restores(
        self, shell_proxy, restore_settings, two_windows
    ):
        restore_settings.set_float_always_on_top(True)
        time.sleep(Timing.SETTINGS_SETTLE)
        shell_proxy.ensure_focus()

        # Float the focused window; with float-always-on-top it is pinned above.
        shell_proxy.invoke_forge_action(FLOAT_TOGGLE)
        wait_for(
            lambda: _count_above_normal(shell_proxy),
            predicate=lambda n: n == 1,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="floated window was not pinned always-on-top",
        )

        # A tiled window goes fullscreen -> the float must be demoted.
        assert _fullscreen_a_tiled_window(shell_proxy) == "ok"
        wait_for(
            lambda: _count_above_normal(shell_proxy),
            predicate=lambda n: n == 0,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="float was not demoted (still always-on-top) under the fullscreen window",
        )

        # The Mutter assumption: the fullscreen window is now stacked above the float.
        assert _fullscreen_stacked_above_float(shell_proxy) == "fs-above", (
            "unmake_above() did not lower the float below the fullscreen window"
        )

        # Exiting fullscreen restores the float above.
        assert _unfullscreen_all(shell_proxy) == "ok"
        wait_for(
            lambda: _count_above_normal(shell_proxy),
            predicate=lambda n: n == 1,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="float was not restored always-on-top after leaving fullscreen",
        )


def _float_the_focused_window(shell_proxy) -> None:
    shell_proxy.ensure_focus()
    shell_proxy.invoke_forge_action(FLOAT_TOGGLE)
    wait_for(
        lambda: _count_above_normal(shell_proxy),
        predicate=lambda n: n == 1,
        timeout=Timing.LAYOUT_CHANGE * 6,
        message="floated window was not pinned always-on-top",
    )


def _demote_under_fullscreen(shell_proxy) -> None:
    assert _fullscreen_a_tiled_window(shell_proxy) == "ok"
    wait_for(
        lambda: _count_above_normal(shell_proxy),
        predicate=lambda n: n == 0,
        timeout=Timing.LAYOUT_CHANGE * 6,
        message="float was not demoted under the fullscreen window",
    )


# Attach a notify::above counter to the (single) float so a make_above/unmake_above
# round-trip is observable even when its end state is unchanged. Idempotent: the
# handler id is kept on the window so a second call does not double-count.
_ARM_ABOVE_COUNTER = (
    "(function(){" + _NORMAL_WINS + "let fl=wins.find(w=>!w.is_fullscreen());"
    "if(!fl) return 'missing';"
    "globalThis.__forgeAboveCount=0;"
    "if(fl.__forgeAboveProbe) fl.disconnect(fl.__forgeAboveProbe);"
    "fl.__forgeAboveProbe=fl.connect('notify::above',()=>{globalThis.__forgeAboveCount++;});"
    "return 'ok';})();"
)
_READ_ABOVE_COUNTER = "globalThis.__forgeAboveCount ?? -1"


class TestFullscreenDemoteFloatSettingsAndUserPins:
    """The three always-on-top defects found by the ownership fuzzer and the review.

    All shipped green under the unit suite because each path was covered alone; the
    fuzzer found them by walking transitions BETWEEN paths. These are those same
    transitions on a real shell.
    """

    def test_toggling_the_setting_during_fullscreen_keeps_the_float_demoted(
        self, shell_proxy, restore_settings, two_windows
    ):
        """restoreAlwaysFloat used to re-pin a demoted float over the fullscreen window.

        Sequence: float pinned -> another window fullscreen (float demoted) -> the user
        turns float-always-on-top OFF then ON again. The float must stay below until
        the fullscreen window goes, then come back.
        """
        restore_settings.set_float_always_on_top(True)
        time.sleep(Timing.SETTINGS_SETTLE)
        _float_the_focused_window(shell_proxy)
        _demote_under_fullscreen(shell_proxy)

        restore_settings.set_float_always_on_top(False)
        time.sleep(Timing.SETTINGS_SETTLE)
        restore_settings.set_float_always_on_top(True)
        time.sleep(Timing.SETTINGS_SETTLE)

        # Still demoted: the fullscreen window is still up.
        assert _count_above_normal(shell_proxy) == 0, (
            "toggling float-always-on-top re-pinned the float over the fullscreen window"
        )
        assert _fullscreen_stacked_above_float(shell_proxy) == "fs-above"

        # And the pin comes back once fullscreen clears — ownership was kept.
        assert _unfullscreen_all(shell_proxy) == "ok"
        wait_for(
            lambda: _count_above_normal(shell_proxy),
            predicate=lambda n: n == 1,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="float was not restored after the setting round-trip",
        )

    def test_renders_during_fullscreen_do_not_churn_the_pin(
        self, shell_proxy, restore_settings, two_windows
    ):
        """The float setter used to re-apply the suspended pin on every render.

        processFloats re-derives `float = true` each pass; the reconcile that follows
        demoted it again, so the END state was right and nothing else could see the
        make_above/unmake_above/lower round-trip — except a notify::above counter.
        """
        restore_settings.set_float_always_on_top(True)
        time.sleep(Timing.SETTINGS_SETTLE)
        _float_the_focused_window(shell_proxy)
        _demote_under_fullscreen(shell_proxy)

        assert shell_proxy.eval(_ARM_ABOVE_COUNTER) == "ok"

        # Drive several renders while the fullscreen window is up. Gap size routes
        # straight to renderTree, so each write is one full pass.
        for gap in (12, 16, 20):
            restore_settings.set_window_gap_size(gap)
            time.sleep(Timing.SETTINGS_SETTLE)

        count = int(shell_proxy.eval(_READ_ABOVE_COUNTER))
        assert count == 0, (
            f"pin toggled {count} time(s) across three renders under fullscreen — "
            "the float setter is re-applying a suspended pin"
        )
        assert _unfullscreen_all(shell_proxy) == "ok"

    def test_a_pin_the_user_applied_survives_unfloating(
        self, shell_proxy, restore_settings, two_windows
    ):
        """FR-003 / bug-319 on a real shell: Forge only ever removes a pin it applied.

        The user pins a TILED window by hand (Bug #469: an always-on-top window is an
        overlay, so it floats out of the grid). Forge did not apply that pin and must
        not claim it — so when the window is tiled back, the pin stays.

        Deliberately NOT the sequence "Forge pins a float, the user unpins it": with
        float-always-on-top on, processFloats re-pins any float on the very next
        render, so a manual unpin of a Forge-pinned float is not a state the shell
        can hold. The review defect this session fixed (ownership surviving a manual
        unpin) is pinned at unit level with renderTree stubbed; its only reachable
        end-to-end consequence is the one asserted here.

        make_above() from Shell.Eval IS a user action: Forge is not on the call
        stack, so _handleUserAboveChange sees it unsuppressed, like the window menu.
        """
        restore_settings.set_float_always_on_top(True)
        time.sleep(Timing.SETTINGS_SETTLE)
        shell_proxy.ensure_focus()

        # The USER pins the focused (tiled) window by hand.
        assert (
            shell_proxy.eval(
                "(function(){ const w = global.display.focus_window; if (!w) return 'none'; "
                "w.make_above(); return 'ok'; })()"
            )
            == "ok"
        )
        wait_for(
            lambda: _count_above_normal(shell_proxy),
            predicate=lambda n: n == 1,
            message="manual pin did not take",
        )
        # #469: the pinned window floated out of the grid — the other one now fills.
        wait_for(
            lambda: max(w["rect"]["width"] for w in shell_proxy.get_windows()),
            predicate=lambda wmax: wmax > 1700,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="user-pinned window was not floated out of the tile grid (#469)",
        )

        # Tile it back explicitly. Forge must leave the user's pin alone.
        shell_proxy.invoke_forge_action({"name": "FloatToggle", "mode": "tile"})
        wait_for(
            lambda: max(w["rect"]["width"] for w in shell_proxy.get_windows()),
            predicate=lambda wmax: wmax < 1700,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="window was not tiled back",
        )

        assert _count_above_normal(shell_proxy) == 1, (
            "tiling the window stripped a pin the USER applied — Forge claimed a pin "
            "it did not create"
        )
