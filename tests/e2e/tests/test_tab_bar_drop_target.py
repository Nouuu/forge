"""close-spec-gaps:N16: a drop on the title bar of a stacked or tabbed container joins it.

Three windows: a center drop with dnd-center-layout tabbed makes a tabbed pair, then the
third window is dropped on the pair's title bar. The bar counts as the center of the
container, so the third window joins it and one TABBED container holds all three. Without
the fix the drop zone on the bar is NONE, the drop does nothing, and the final wait times
out on the pair beside the lone window.

fuzzDrag sets the drop target itself, so this proves the zone half of the fix. The unit
test bug-close-spec-gaps-n16-tab-bar-drop-target pins the target finder.
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
def test_drop_on_tab_bar_joins_the_group(shell_proxy, restore_settings, three_windows):
    restore_settings.set("dnd-center-layout", "tabbed")
    time.sleep(Timing.SETTINGS_SETTLE)

    res = shell_proxy.fuzz_drag("leftmost", "rightmost", "center")
    assert isinstance(res, dict) and res.get("ok") and res.get("dropped"), res
    time.sleep(Timing.STACKED_LAYOUT_CHANGE)
    wait_for(
        lambda: _cons(shell_proxy.get_forge_tree()),
        predicate=lambda cons: ("TABBED", 2) in cons,
        message="no TABBED container with two windows after the center drag",
    )

    # The pair sits in the right slot, the third window alone on the left: drop the lone
    # window on the pair's title bar.
    res = shell_proxy.fuzz_drag("leftmost", "rightmost", "bar")
    assert isinstance(res, dict) and res.get("ok") and res.get("dropped"), res

    wait_for(
        lambda: _cons(shell_proxy.get_forge_tree()),
        predicate=lambda cons: ("TABBED", 3) in cons and ("TABBED", 2) not in cons,
        message="the window dropped on the title bar did not join the TABBED pair",
    )
