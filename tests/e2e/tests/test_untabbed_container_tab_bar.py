"""close-spec-gaps:N13: a container that leaves tabbed must drop its tab bar.

Three windows: two form a tabbed group (a center drop with dnd-center-layout tabbed), then one
tab is dragged onto the third window. The old group is left with one window and stops being
tabbed; its tab bar must go with it. Without the fix the bar stays visible in window_group
above the window left alone (the focus moved away with the dragged tab), so the stale-bar
count stays above zero and the final wait times out.
"""

import time

import pytest
from framework.constants import Timing
from framework.wait import wait_for


@pytest.mark.drag
def test_no_stale_tab_bar_after_tab_dragged_out(shell_proxy, restore_settings, three_windows):
    restore_settings.set("dnd-center-layout", "tabbed")
    time.sleep(Timing.SETTINGS_SETTLE)

    res = shell_proxy.fuzz_drag("leftmost", "rightmost", "center")
    assert isinstance(res, dict) and res.get("ok") and res.get("dropped"), res
    time.sleep(Timing.STACKED_LAYOUT_CHANGE)

    # Precondition: the tab group exists, so a bar is alive and owned by a tabbed container.
    wait_for(
        lambda: shell_proxy.get_stale_decorations(),
        predicate=lambda d: d.get("stale") == 0,
        message="a stale tab bar already exists before the drag-out",
    )

    # The group sits in the right slot, the third window alone on the left: drag a group
    # member (rightmost) onto the center of the lone window.
    res = shell_proxy.fuzz_drag("rightmost", "leftmost", "center")
    assert isinstance(res, dict) and res.get("ok") and res.get("dropped"), res

    wait_for(
        lambda: shell_proxy.get_stale_decorations(),
        predicate=lambda d: d.get("stale") == 0,
        message="a tab bar of a container that left tabbed is still visible",
    )
