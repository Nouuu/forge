"""F-08 (fork-sync US1): the neighbours follow a window-system resize grab live.

Before, the right-hand window stayed put during the drag and snapped to its new size on
release. The bridge drives a real RESIZING_E grab on the left of two tiled windows and
grows its frame step by step, the way Mutter does while the edge moves.
"""

import time

from framework.wait import wait_for

STEP = 50
STEPS = 6
GAP_TOLERANCE = 20


def _followed(frames: dict, left_width: int) -> bool:
    """The left window has its new width (the client committed it) and the right one
    starts where it now ends."""
    left, right = frames["left"], frames["right"]
    grown = left["width"] >= left_width - 2
    return grown and abs(right["x"] - (left["x"] + left["width"])) <= GAP_TOLERANCE


def _same(a: dict, b: dict) -> bool:
    return all(a[k] == b[k] for k in ("left", "right", "renders"))


def _two_reads(shell_proxy) -> tuple:
    first = shell_proxy.live_resize_frames()
    time.sleep(0.2)
    return first, shell_proxy.live_resize_frames()


def test_neighbour_follows_the_resize_grab(shell_proxy, two_windows):
    begin = shell_proxy.live_resize_begin()
    assert begin["ok"], begin
    try:
        # About two seconds of drag: the right edge of the left window and the left edge
        # of the right one stay together after every step, before the grab ends.
        start_width = begin["left"]["width"]
        for step in range(STEPS):
            shell_proxy.live_resize_step(STEP)
            target = start_width + STEP * (step + 1)
            wait_for(
                shell_proxy.live_resize_frames,
                predicate=lambda f, target=target: _followed(f, target),
                timeout=1,
                message=f"step {step + 1}: the right window did not follow the edge",
            )
            time.sleep(0.3)

        # Idle: once a slow client has committed, a held grab renders nothing more.
        first, _ = wait_for(
            lambda: _two_reads(shell_proxy),
            predicate=lambda reads: _same(*reads),
            message="frames still changing after the last step",
        )
        time.sleep(1)
        assert _same(first, shell_proxy.live_resize_frames()), "a render ran while the grab idled"
        before_release = shell_proxy.live_resize_frames()
    finally:
        end = shell_proxy.live_resize_end()

    # No snap on release, and the pair still fills the work area.
    for side in ("left", "right"):
        for k in ("x", "y", "width", "height"):
            assert abs(end[side][k] - before_release[side][k]) <= 1, (side, k, end)
    wa = end["workArea"]
    assert end["left"]["x"] - wa["x"] <= GAP_TOLERANCE, end
    assert (wa["x"] + wa["width"]) - (end["right"]["x"] + end["right"]["width"]) <= GAP_TOLERANCE, (
        end
    )


def test_neighbour_follows_gnome_keyboard_resize(shell_proxy, two_windows):
    """Alt+F8 then Right arrows at a person's pace: the right window follows every step
    before Return, and the layout keeps the new size after it."""
    begin = shell_proxy.keyboard_resize_begin()
    assert begin["ok"] and begin["began"], begin
    width = begin["left"]["width"]
    try:
        # The first arrow only picks the edge. Each later one grows the frame by 10 px from
        # the size the client last committed (meta-window-drag.c), so wait for each commit.
        shell_proxy.simulate_key_combo("Right")
        for step in range(5):
            shell_proxy.simulate_key_combo("Right")
            frames = wait_for(
                shell_proxy.keyboard_resize_frames,
                predicate=lambda f, w=width: f["grabbing"] and _followed(f, w + 5),
                timeout=2,
                message=f"step {step + 1}: the right window did not follow the keyboard resize",
            )
            width = frames["left"]["width"]
    finally:
        shell_proxy.simulate_key_combo("Return")

    end = wait_for(
        shell_proxy.keyboard_resize_frames,
        predicate=lambda f: not f["grabbing"],
        message="the keyboard resize did not end",
    )
    assert abs(end["left"]["width"] - width) <= 1 and _followed(end, width), end
