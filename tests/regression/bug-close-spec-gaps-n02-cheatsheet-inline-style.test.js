import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "../../lib/css/index.js";
import { Cheatsheet } from "../../lib/extension/cheatsheet.js";
import { installGnomeGlobals } from "../mocks/helpers/index.js";

/**
 * close-spec-gaps:N02: inline styles beat the cheatsheet rules of the stylesheet.
 *
 * cheatsheet.js set inline styles that repeat what a class rule of stylesheet.css declares:
 * the overlay (background, radius, padding, border), the row (margin-top) and the key
 * (min-width). An inline style wins over a stylesheet rule, so a user edit to that rule had
 * no effect (FR-015).
 *
 * Fix: those inline declarations are removed, for every classed actor the cheatsheet builds.
 *
 * close-spec-gaps:N06: the close button kept an inline color, border-radius and padding. The
 * N02 check only looked at properties that stylesheet.css declares, and it had no
 * .forge-cheatsheet-close rule, so a user rule for the button had no effect (FR-015).
 *
 * Fix: the three declarations move to a .forge-cheatsheet-close rule and cssTag goes from 38
 * to 39, so each user copy is replaced on the next start and kept as stylesheet.css.38.bak
 * (theming-config:G014). The check is now that no actor with a forge-cheatsheet* class sets
 * an inline style, whatever the stylesheet declares. Actors with no forge class keep theirs.
 * A second check pins the three declarations in the bundled stylesheet.css, so dropping the
 * rule leaves the button unstyled and turns the suite red.
 */
const walk = (actor, out = []) => {
  out.push(actor);
  for (const child of actor.get_children?.() ?? []) walk(child, out);
  return out;
};

describe("close-spec-gaps:N02/N06: no forge-cheatsheet actor sets an inline style", () => {
  let ctx;

  beforeEach(() => {
    ctx = installGnomeGlobals({ display: { monitorCount: 1 } });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("overlay, category section and backdrop", () => {
    const cheatsheet = new Cheatsheet({ kbdSettings: { list_keys: () => [] } });
    cheatsheet._buildOverlay();
    cheatsheet._ensureBackdrop();
    const classed = [
      ...walk(cheatsheet._overlay),
      ...walk(
        cheatsheet._createCategorySection("Cat", [{ shortcut: "Super+a", description: "Do a" }])
      ),
      ...walk(cheatsheet._backdrop),
    ].filter((a) => /(^|\s)forge-cheatsheet/.test(a.style_class ?? ""));

    expect(new Set(classed.map((a) => a.style_class))).toEqual(
      new Set([
        "forge-cheatsheet",
        "forge-cheatsheet-close",
        "forge-cheatsheet-category",
        "forge-cheatsheet-row",
        "forge-cheatsheet-key",
        "forge-cheatsheet-desc",
        "forge-cheatsheet-backdrop",
      ])
    );
    expect(classed.filter((a) => a.style).map((a) => `${a.style_class}: ${a.style}`)).toEqual([]);
  });
});

describe("close-spec-gaps:N06: stylesheet.css styles the close button", () => {
  it("declares color, border-radius and padding for .forge-cheatsheet-close", () => {
    const css = readFileSync(new URL("../../stylesheet.css", import.meta.url), "utf8");
    const rule = parse(css).stylesheet.rules.find((r) =>
      r.selectors?.includes(".forge-cheatsheet-close")
    );
    expect(rule?.declarations.map((d) => d.property)).toEqual(
      expect.arrayContaining(["color", "border-radius", "padding"])
    );
  });
});
