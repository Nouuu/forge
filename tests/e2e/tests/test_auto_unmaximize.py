"""close-spec-gaps:N11: auto-unmaximize-for-tiling acts when a new window tiles.

trackWindow runs inside display::window-created and, with the setting on, unmaximizes
a maximized tiled neighbour when the new window will tile. About 200 ms later the
window-create render re-slices every tiled window, and move() unmaximizes the
neighbour whatever the setting says (forge-dyt2 keeps only a lone window maximized).
So the end state is the same either way. The setting only decides whether the
neighbour unmaximizes as the new window maps.

The probe therefore reads the neighbour inside window-created, in a handler connected
after Forge's own one, so it runs right after trackWindow and before any render. The
lone window is maximized by window-maximize-on-single (Compat.maximize, then Mutter's
own state), which is also the case where a user meets this setting.
"""

import time

import pytest
from framework.constants import Timing
from framework.wait import wait_for

_ARM_PROBE = r"""
(() => {
  const isMax = (w) =>
    typeof w.is_maximized === "function"
      ? w.is_maximized()
      : w.get_maximized() === Meta.MaximizeFlags.BOTH;
  const target = global.workspace_manager.get_active_workspace().list_windows().find(isMax);
  if (!target) return "no-maximized-window";
  globalThis.__forgeN11Probe = null;
  globalThis.__forgeN11ProbeId = global.display.connect("window-created", (_d, w) => {
    if (w === target || w.get_window_type() !== Meta.WindowType.NORMAL) return;
    global.display.disconnect(globalThis.__forgeN11ProbeId);
    globalThis.__forgeN11ProbeId = 0;
    try {
      const wm = Main.extensionManager.lookup("forge@jmmaranan.com").stateObj.extWm;
      globalThis.__forgeN11Probe = JSON.stringify({
        maximized: isMax(target),
        willTile: !wm._shouldFloat(w),
        title: w.get_title(),
        wmClass: w.get_wm_class(),
      });
    } catch (e) {
      globalThis.__forgeN11Probe = JSON.stringify({ error: String(e) });
    }
  });
  return "ok";
})()
"""

_READ_PROBE = "globalThis.__forgeN11Probe ?? 'not-fired'"

_DISARM_PROBE = (
    "(() => { if (globalThis.__forgeN11ProbeId) "
    "global.display.disconnect(globalThis.__forgeN11ProbeId); "
    "globalThis.__forgeN11ProbeId = 0; return 'ok'; })()"
)


class TestAutoUnmaximizeForTiling:
    @pytest.mark.parametrize("enabled", [True, False], ids=["on", "off"])
    def test_new_window_unmaximizes_its_maximized_neighbour(
        self, shell_proxy, restore_settings, launch_window, enabled
    ):
        restore_settings.set("auto-unmaximize-for-tiling", enabled)
        restore_settings.set("window-maximize-on-single", True)
        time.sleep(Timing.SETTINGS_SETTLE)

        launch_window()
        wait_for(
            shell_proxy.count_maximized_windows,
            predicate=lambda n: n == 1,
            message="precondition: the lone tiled window should be maximized",
        )

        assert shell_proxy.eval(_ARM_PROBE) == "ok"
        try:
            launch_window()
            probe = shell_proxy.eval(_READ_PROBE)
        finally:
            shell_proxy.eval(_DISARM_PROBE)

        assert isinstance(probe, dict) and "error" not in probe, f"probe failed: {probe!r}"
        if enabled:
            assert probe["willTile"], (
                f"the new window mapped float-exempt, so the setting cannot act at track "
                f"time on this lane: {probe}"
            )
            assert not probe["maximized"], (
                f"the maximized neighbour was not unmaximized when the new window was "
                f"tracked: {probe}"
            )
        else:
            assert probe["maximized"], f"the setting is off but the neighbour unmaximized: {probe}"
