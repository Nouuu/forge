"""close-spec-gaps:N16: a drop on the title bar of a stacked or tabbed container joins it.

Three windows: a center drop with dnd-center-layout tabbed makes a tabbed pair, then the
third window is dropped on the pair's title bar. The bar counts as the center of the
container, so the third window joins it and one TABBED container holds all three. Without
the fix the drop zone on the bar is NONE, the drop does nothing, and the final wait times
out on the pair beside the lone window.

fuzzDrag sets the drop target itself, so this proves the zone half of the fix. The unit
test bug-close-spec-gaps-n16-tab-bar-drop-target pins the target finder.

close-spec-gaps:N21 adds a center drop inside a split column, which groups only two windows.
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


@pytest.mark.drag
def test_center_drop_in_a_split_column_groups_two(shell_proxy, restore_settings, four_windows):
    """close-spec-gaps:N21: a center drop in a split container groups only the two windows.

    Four windows side by side. The rightmost is dropped on the bottom of the leftmost, which
    makes a VSPLIT column of two. The new rightmost window is then dropped on the center of
    the column's bottom window. Before the fix the whole column turned TABBED with three
    windows; now the column keeps its top window above a TABBED pair."""
    restore_settings.set("dnd-center-layout", "tabbed")
    time.sleep(Timing.SETTINGS_SETTLE)

    res = shell_proxy.fuzz_drag("rightmost", "leftmost", "bottom")
    assert isinstance(res, dict) and res.get("ok") and res.get("dropped"), res
    wait_for(
        lambda: _cons(shell_proxy.get_forge_tree()),
        predicate=lambda cons: ("VSPLIT", 2) in cons,
        message="setup: no VSPLIT column of two after the bottom drop",
    )
    # "rightmost" and "bottommost" read live frames: wait for the column's bottom slot.
    wait_for(
        shell_proxy.get_windows,
        predicate=lambda ws: len(ws) == 4 and sum(w["rect"]["y"] > 300 for w in ws) == 1,
        message="setup: the dropped window did not settle in the column's bottom slot",
    )

    res = shell_proxy.fuzz_drag("rightmost", "bottommost", "center")
    assert isinstance(res, dict) and res.get("ok") and res.get("dropped"), res

    cons = wait_for(
        lambda: _cons(shell_proxy.get_forge_tree()),
        predicate=lambda c: ("TABBED", 2) in c or ("TABBED", 3) in c,
        message="the center drop made no TABBED group",
    )
    assert ("TABBED", 3) not in cons, f"the whole column turned TABBED: {cons}"
    assert ("TABBED", 2) in cons and ("VSPLIT", 3) in cons, cons
