"""close-spec-gaps:N11: auto-unmaximize-for-tiling decides whether a maximized window
stays maximized when a new window tiles beside it.

The render decides, once processFloats has tiled the new window, so a native Wayland
window whose title and class land after window-created is covered too. On: the
neighbour is unmaximized. Off: it stays maximized, also when the user maximizes it
again beside the new window (the Bug #461 size-change path keeps it too). The lone
window is maximized by window-maximize-on-single, the case where a user meets this
setting.
"""

import time

import pytest
from framework.constants import Timing
from framework.wait import WaitTimeoutError, wait_for

# Mutter's own state for the window with this id, read by feature detection; the
# monitors of the other normal windows that sit on another monitor; and how many tiled
# windows Forge counts on its monitor node, the input of _keepsMaximize.
_STATE = r"""
(() => {
  const wins = global.workspace_manager.get_active_workspace().list_windows();
  const w = wins.find((x) => x.get_id() === %d);
  if (!w) return JSON.stringify({ error: "the first window is gone" });
  const flags =
    typeof w.get_maximize_flags === "function" ? w.get_maximize_flags() : w.get_maximized();
  const f = w.get_frame_rect();
  const a = w.get_work_area_current_monitor();
  const wm = Main.extensionManager.lookup("forge@jmmaranan.com").stateObj.extWm;
  const node = wm.findNodeWindow(w);
  const mon = node ? wm.tree.findAncestorMonitor(node) : null;
  return JSON.stringify({
    maximized: flags === Meta.MaximizeFlags.BOTH,
    landed: f.width === a.width && f.height === a.height,
    monitor: w.get_monitor(),
    strays: wins
      .filter(
        (x) =>
          x !== w &&
          x.get_window_type() === Meta.WindowType.NORMAL &&
          x.get_monitor() !== w.get_monitor()
      )
      .map((x) => x.get_monitor()),
    tiledBeside: mon ? wm._tiledWindowsOnMonitor(mon).length : 0,
  });
})()
"""

# Maximize (true) or unmaximize (false) the window with this id on both axes, the way
# a user does, by feature detection (Mutter 49 stages the flags first).
_SET_MAXIMIZED = r"""
(() => {
  const w = global.workspace_manager
    .get_active_workspace()
    .list_windows()
    .find((x) => x.get_id() === %d);
  if (!w) return "gone";
  const on = %s;
  const both = Meta.MaximizeFlags.BOTH;
  if (typeof w.set_maximize_flags === "function") {
    if (on) {
      w.set_maximize_flags(both);
      w.maximize();
    } else {
      w.set_unmaximize_flags(both);
      w.unmaximize();
    }
  } else if (on) w.maximize(both);
  else w.unmaximize(both);
  return "ok";
})()
"""


def _tile_beside(shell_proxy, state):
    """Wait until Forge tiles the second window on the first window's monitor.

    On the two-monitor lanes Mutter may place the new window on the other monitor;
    move it onto the first window's monitor, or skip when that cannot be done.
    """
    s = state()
    if s["tiledBeside"] == 2:
        return
    if not s["strays"]:
        wait_for(
            state,
            predicate=lambda s: s["tiledBeside"] == 2,
            message="the new window should tile beside the first",
        )
        return
    if (
        shell_proxy.activate_window_on_monitor(s["strays"][0]) != "ok"
        or shell_proxy.move_focused_window_to_monitor(s["monitor"]) != "ok"
    ):
        pytest.skip(f"cannot move the new window onto the first window's monitor: {s}")
    try:
        wait_for(state, predicate=lambda s: s["tiledBeside"] == 2)
    except WaitTimeoutError:
        pytest.skip(f"the new window did not tile on the first window's monitor: {state()}")


class TestAutoUnmaximizeForTiling:
    @pytest.mark.parametrize("enabled", [True, False], ids=["on", "off"])
    def test_new_tiled_window_and_its_maximized_neighbour(
        self, shell_proxy, restore_settings, launch_window, enabled
    ):
        restore_settings.set("auto-unmaximize-for-tiling", enabled)
        restore_settings.set("window-maximize-on-single", True)
        time.sleep(Timing.SETTINGS_SETTLE)

        first = launch_window()

        def state():
            return shell_proxy.eval(_STATE % first["id"])

        # Wait for the maximized frame too: a late size-changed would hit the
        # Bug #461 rejection once the second window tiles.
        wait_for(
            state,
            predicate=lambda s: s["maximized"] and s["landed"],
            message="precondition: the lone tiled window should be maximized",
        )

        launch_window()
        wait_for(
            lambda: shell_proxy.count_tiled_windows_of_class(first["wmClass"]),
            predicate=lambda n: n == 2,
            message="the new window should tile",
        )
        _tile_beside(shell_proxy, state)

        if enabled:
            wait_for(
                state,
                predicate=lambda s: not s["maximized"],
                message="setting on: the maximized neighbour should be unmaximized",
            )
            return

        # Every render after the tile would unmaximize it; give them time to run.
        time.sleep(Timing.WINDOW_SETTLE)
        after = state()
        assert after["maximized"], f"setting off: the neighbour was unmaximized: {after}"

        # A size change on a full maximize beside a tiled window: the user unmaximizes
        # it, a render re-tiles it into its slot, then the user maximizes it again.
        assert shell_proxy.eval(_SET_MAXIMIZED % (first["id"], "false")) == "ok"
        wait_for(
            state,
            predicate=lambda s: not s["maximized"],
            message="precondition: the window should unmaximize",
        )
        shell_proxy.fuzz_render_now()
        wait_for(
            state,
            predicate=lambda s: not s["landed"],
            message="precondition: the unmaximized window should re-tile into its slot",
        )
        assert shell_proxy.eval(_SET_MAXIMIZED % (first["id"], "true")) == "ok"
        wait_for(
            state,
            predicate=lambda s: s["maximized"] and s["landed"],
            message="setting off: a full maximize beside a tiled window should stay",
        )
        time.sleep(Timing.WINDOW_SETTLE)
        after = state()
        assert after["maximized"], f"setting off: the maximize was rejected: {after}"
