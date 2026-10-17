import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "../../lib/css/index.js";
import { Cheatsheet } from "../../lib/extension/cheatsheet.js";
import { installGnomeGlobals } from "../mocks/helpers/index.js";

/**
 * close-spec-gaps:N02: the overlay's inline style beat .forge-cheatsheet.
 *
 * cheatsheet.js set an inline style (background, radius, padding, border) that repeats the
 * .forge-cheatsheet rule of stylesheet.css. An inline style wins over a stylesheet rule, so a
 * user edit to that rule had no effect.
 *
 * Fix: the inline style is removed; the stylesheet styles the overlay.
 */
const css = readFileSync(new URL("../../stylesheet.css", import.meta.url), "utf8");

describe("close-spec-gaps:N02: the overlay sets no inline property the stylesheet declares", () => {
  let ctx;

  beforeEach(() => {
    ctx = installGnomeGlobals({ display: { monitorCount: 1 } });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("no inline property of the overlay is declared by .forge-cheatsheet", () => {
    const rule = parse(css).stylesheet.rules.find(
      (r) => r.type === "rule" && r.selectors.includes(".forge-cheatsheet")
    );
    const declared = rule.declarations
      .filter((d) => d.type === "declaration")
      .map((d) => d.property);
    expect(declared).toContain("background-color");

    const cheatsheet = new Cheatsheet({ kbdSettings: { list_keys: () => [] } });
    cheatsheet._buildOverlay();
    const inline = (cheatsheet._overlay.style ?? "")
      .split(";")
      .map((p) => p.split(":")[0].trim())
      .filter(Boolean);
    expect(inline.filter((p) => declared.includes(p))).toEqual([]);
  });
});
