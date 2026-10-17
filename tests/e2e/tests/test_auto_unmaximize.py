"""close-spec-gaps:N11: auto-unmaximize-for-tiling decides whether a maximized window
stays maximized when a new window tiles beside it.

The render decides, once processFloats has tiled the new window, so a native Wayland
window whose title and class land after window-created is covered too. On: the
neighbour is unmaximized. Off: it stays maximized. The lone window is maximized by
window-maximize-on-single, the case where a user meets this setting.
"""

import time

import pytest
from framework.constants import Timing
from framework.wait import wait_for

# Mutter's own state for the window with this id, read by feature detection.
_STATE = r"""
(() => {
  const wins = global.workspace_manager.get_active_workspace().list_windows();
  const w = wins.find((x) => x.get_id() === %d);
  if (!w) return JSON.stringify({ error: "the first window is gone" });
  const maximized =
    typeof w.is_maximized === "function"
      ? w.is_maximized()
      : w.get_maximized() === Meta.MaximizeFlags.BOTH;
  const f = w.get_frame_rect();
  const a = w.get_work_area_current_monitor();
  return JSON.stringify({
    maximized,
    landed: f.width === a.width && f.height === a.height,
    sameMonitor: wins.every((x) => x.get_monitor() === w.get_monitor()),
  });
})()
"""


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
            message="the new window should tile beside the first",
        )
        assert state()["sameMonitor"], f"both windows must share a monitor: {state()}"

        if enabled:
            wait_for(
                state,
                predicate=lambda s: not s["maximized"],
                message="setting on: the maximized neighbour should be unmaximized",
            )
        else:
            # Every render after the tile would unmaximize it; give them time to run.
            time.sleep(Timing.WINDOW_SETTLE)
            after = state()
            assert after["maximized"], f"setting off: the neighbour was unmaximized: {after}"
