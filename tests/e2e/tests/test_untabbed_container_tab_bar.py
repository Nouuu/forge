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


def _cons(node, out=None):
    """Every CON of the tree as (layout, number of WINDOW descendants)."""
    out = [] if out is None else out
    if not isinstance(node, dict):
        return out

    def windows(n):
        own = 1 if n.get("nodeType") == "WINDOW" else 0
        return own + sum(windows(c) for c in n.get("children") or [])

    if node.get("nodeType") == "CON":
        out.append((node.get("layout"), windows(node)))
    for c in node.get("children") or []:
        _cons(c, out)
    return out


@pytest.mark.drag
def test_no_stale_tab_bar_after_tab_dragged_out(shell_proxy, restore_settings, three_windows):
    restore_settings.set("dnd-center-layout", "tabbed")
    time.sleep(Timing.SETTINGS_SETTLE)

    res = shell_proxy.fuzz_drag("leftmost", "rightmost", "center")
    assert isinstance(res, dict) and res.get("ok") and res.get("dropped"), res
    time.sleep(Timing.STACKED_LAYOUT_CHANGE)

    # Precondition: a TABBED container holds two windows, so a bar is alive.
    wait_for(
        lambda: _cons(shell_proxy.get_forge_tree()),
        predicate=lambda cons: ("TABBED", 2) in cons,
        message="no TABBED container with two windows after the first drag",
    )
    wait_for(
        lambda: shell_proxy.get_stale_decorations(),
        predicate=lambda d: d.get("stale") == 0,
        message="a stale tab bar already exists before the drag-out",
    )

    # The group sits in the right slot, the third window alone on the left: drag a group
    # member (rightmost) onto the center of the lone window.
    res = shell_proxy.fuzz_drag("rightmost", "leftmost", "center")
    assert isinstance(res, dict) and res.get("ok") and res.get("dropped"), res

    # The target group is TABBED with two windows; the old container is gone or a lone split.
    cons = wait_for(
        lambda: _cons(shell_proxy.get_forge_tree()),
        predicate=lambda c: ("TABBED", 2) in c,
        message="the dragged tab did not join the target as a TABBED group of two",
    )
    assert not any(layout in ("STACKED", "TABBED") and n == 1 for layout, n in cons), cons

    wait_for(
        lambda: shell_proxy.get_stale_decorations(),
        predicate=lambda d: d.get("stale") == 0,
        message="a tab bar of a container that left tabbed is still visible",
    )
