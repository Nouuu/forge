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
 * Inline properties no class rule declares stay (moving them would need a cssTag bump).
 */
const css = readFileSync(new URL("../../stylesheet.css", import.meta.url), "utf8");

const walk = (actor, out = []) => {
  out.push(actor);
  for (const child of actor.get_children?.() ?? []) walk(child, out);
  return out;
};

describe("close-spec-gaps:N02: no cheatsheet actor sets an inline property its class rule declares", () => {
  let ctx;

  beforeEach(() => {
    ctx = installGnomeGlobals({ display: { monitorCount: 1 } });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("every classed actor, shorthands included", () => {
    const declaredBy = new Map();
    for (const r of parse(css).stylesheet.rules) {
      if (r.type !== "rule") continue;
      for (const sel of r.selectors) {
        if (!/^\.forge-cheatsheet[\w-]*$/.test(sel)) continue;
        declaredBy.set(
          sel.slice(1),
          r.declarations.filter((d) => d.type === "declaration").map((d) => d.property)
        );
      }
    }
    expect(declaredBy.size).toBeGreaterThan(0);

    const cheatsheet = new Cheatsheet({ kbdSettings: { list_keys: () => [] } });
    cheatsheet._buildOverlay();
    const actors = [
      ...walk(cheatsheet._overlay),
      ...walk(
        cheatsheet._createCategorySection("Cat", [{ shortcut: "Super+a", description: "Do a" }])
      ),
    ];

    const clashes = [];
    for (const actor of actors) {
      const inline = (actor.style ?? "")
        .split(";")
        .map((p) => p.split(":")[0].trim())
        .filter(Boolean);
      for (const cls of (actor.style_class ?? "").split(/\s+/)) {
        for (const prop of declaredBy.get(cls) ?? []) {
          for (const q of inline) {
            if (q === prop || q.startsWith(`${prop}-`)) clashes.push(`${cls}: ${q}`);
          }
        }
      }
    }
    expect(clashes).toEqual([]);
  });
});
