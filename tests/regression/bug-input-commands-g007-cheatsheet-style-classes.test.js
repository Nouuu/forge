import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * input-commands:G-007: a cheatsheet rule had no actor.
 *
 * stylesheet.css kept a .forge-cheatsheet-title rule, but no actor in cheatsheet.js sets that
 * class, so the rule styled nothing.
 *
 * Fix: the rule is deleted (no cssTag bump: a dead rule in a user copy is harmless, a bump
 * would overwrite the copy). forge-cheatsheet-close and forge-cheatsheet-backdrop have no
 * rule on purpose: kept as hooks (the backdrop is the locator of test_cheatsheet_dismiss.py,
 * the close class lets users theme the button).
 */
const css = readFileSync(new URL("../../stylesheet.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../../lib/extension/cheatsheet.js", import.meta.url), "utf8");

describe("input-commands:G-007: every .forge-cheatsheet* selector has an actor", () => {
  it("each stylesheet class is set as a style_class in cheatsheet.js", () => {
    const selectors = [...new Set(css.match(/\.forge-cheatsheet[\w-]*/g))].map((s) => s.slice(1));
    expect(selectors.length).toBeGreaterThan(0);
    const missing = selectors.filter((c) => !js.includes(`style_class: "${c}"`));
    expect(missing).toEqual([]);
  });
});
