import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CommandHandler } from "../../lib/extension/command.js";
import { installGnomeGlobals } from "../mocks/helpers/index.js";

/**
 * input-commands:G-017: window-gap-size-increment had no schema range, so GapSize's 0-32
 * clamp in command.js stood alone and a hand-set value outside it reached the layout.
 *
 * Fix: the key carries <range min="0" max="32"/>, equal to the clamp. The stub below
 * refuses out-of-range writes as GLib does, using the range read off the gschema.
 */
const GSCHEMA = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schemas",
  "org.gnome.shell.extensions.forge.gschema.xml"
);

function incrementRange() {
  const xml = readFileSync(GSCHEMA, "utf8");
  const key = /<key\b[^>]*name="window-gap-size-increment"[^>]*>([\s\S]*?)<\/key>/.exec(xml)[1];
  const r = /<range\s+min="(\d+)"\s+max="(\d+)"/.exec(key);
  return r ? [Number(r[1]), Number(r[2])] : null;
}

describe("input-commands:G-017: GapSize and the schema range agree", () => {
  let ctx;
  let handler;
  let stored;
  let range;

  beforeEach(() => {
    ctx = installGnomeGlobals();
    range = incrementRange();
    stored = 1;
    handler = new CommandHandler({
      focusMetaWindow: null,
      findNodeWindow: () => null,
      ext: {
        settings: {
          get_uint: () => stored,
          set_uint: (_k, v) => {
            if (range && (v < range[0] || v > range[1])) return false;
            stored = v;
            return true;
          },
        },
      },
    });
  });

  afterEach(() => ctx.cleanup());

  it("the schema range of window-gap-size-increment is 0-32", () => {
    expect(range).toEqual([0, 32]);
  });

  it.each([
    [32, 1],
    [0, -50],
    [0, 50],
  ])("from %i, amount %i: the written value equals a schema bound", (from, amount) => {
    stored = from;
    handler.execute({ name: "GapSize", amount });
    expect(stored).toBe(amount > 0 ? range?.[1] : range?.[0]);
  });
});
