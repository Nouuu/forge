import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../mocks/helpers/index.js";

/**
 * Bug mixed-percent-split-overflow (2026-09-14, journal on a live session): after an
 * extension off→on, and sporadically in normal use, a split row rendered one window
 * at the full container size while its last sibling was never placed at all
 * (`Tree.apply` logged `ignoring apply for -958x1166`, `-639x1166`, `0x1166`,
 * `3838x0`). Windows overlapped the screen until a drag reset the percents.
 *
 * Root cause: `computeSizes` gave every child with an explicit `percent` exactly
 * that share and every unset child (`percent` 0) the default `1/N`, so a row mixing
 * the two summed past the container — `[1.0, 0, 0, 0]` on 1918 px is
 * `[1918, 479, 479, 479]` — and the Bug #330 remainder fold pushed the LAST child
 * to `479 - 1437 = -958`. Such rows are produced by ordinary paths: a window
 * float-exempt at map time (null wm_class) skips `insertChildPercent` and later
 * re-tiles, a re-homed node keeps its old share, `redistributeSiblingPercent`
 * pushes a lone survivor to 1.0 before a new sibling arrives.
 *
 * Fix: unset children take an equal `1/N` share and the explicit ones are scaled
 * into whatever remains, so the row always sums to the container and no child can
 * go negative or zero.
 */
describe("Bug mixed-percent-split-overflow: explicit and unset percents share one row", () => {
  let ctx, tree, monitor;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    tree = ctx.tree;
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1918, height: 1166 };
  });

  afterEach(() => ctx.cleanup());

  function row(percents) {
    return percents.map((percent, i) => {
      const { nodeWindow } = createWindowNode(tree, monitor, { windowOverrides: { id: `w${i}` } });
      nodeWindow.percent = percent;
      return nodeWindow;
    });
  }

  const sum = (sizes) => sizes.reduce((a, b) => a + b, 0);

  it("one explicit 1.0 child among three unset ones splits equally (the enable case)", () => {
    const sizes = tree.computeSizes(monitor, row([1.0, 0, 0, 0]));
    expect(sizes).toEqual([479, 479, 479, 481]);
    expect(sum(sizes)).toBe(1918);
  });

  it("a lone survivor at 1.0 plus a newcomer at 0 is a half split (the 0x1166 case)", () => {
    const sizes = tree.computeSizes(monitor, row([1.0, 0]));
    expect(sizes).toEqual([959, 959]);
  });

  it("explicit children keep their ratio inside the space the unset ones leave", () => {
    const sizes = tree.computeSizes(monitor, row([0.6, 0.2, 0]));
    // Unset child: 1/3 (plus the #330 rounding remainder, folded onto the last
    // child). Explicit pair scaled into the remaining 2/3 with its 3:1 ratio kept.
    expect(sizes).toEqual([959, 319, 640]);
    expect(sum(sizes)).toBe(1918);
  });

  it("leaves an all-unset row and a normalized explicit row untouched", () => {
    expect(tree.computeSizes(monitor, row([0, 0, 0]))).toEqual([639, 639, 640]);
    expect(tree.computeSizes(monitor, row([0.25, 0.75]))).toEqual([479, 1439]);
  });
});
