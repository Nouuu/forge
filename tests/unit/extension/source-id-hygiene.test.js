import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Source-id teardown fence (docs/dev/hazards.md class 6).
 *
 * A `GLib.timeout_add` / `idle_add` whose id is not removed when its owner is torn
 * down keeps firing against a dead object — the classic GNOME-extension crash, and
 * the one class in the hazard catalog that had no guardrail at all.
 *
 * Every site in `lib/` already STORES its id; the gap was never that. The gap is
 * that nothing ties a stored id to a teardown path: adding a timeout and forgetting
 * the matching clear line is a one-line omission, invisible in review and invisible
 * to a green suite until a user disables the extension with one in flight.
 *
 * So this fence discovers the ids from the source instead of listing them. Add a
 * timeout anywhere in lib/ and this test starts failing until its id is cleared on
 * teardown — no test edit needed, which is the whole point: a hand-maintained list
 * would drift exactly like the one it is guarding.
 *
 * A repo-local ESLint rule (`no-untracked-timeout`) was considered instead and
 * rejected: it can only see whether the returned id is assigned somewhere, which is
 * already true at all 12 sites. The defect lives in the teardown, which is a
 * different function — out of reach of a per-node lint rule, in reach of this.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** `this._fooId = GLib.timeout_add(...)` / `idle_add` — the owner-scoped sites. */
const OWNED_ID_ASSIGN =
  /this\.(_[A-Za-z0-9]*(?:SrcId|SourceId|TimeoutId|EndId|DebounceId|ClearId))\s*=\s*GLib\.(?:timeout_add|timeout_add_seconds|idle_add)\s*\(/g;

/** Every `GLib.timeout_add`/`idle_add` call, however its result is handled. */
const ANY_SOURCE_ADD = /GLib\.(?:timeout_add|timeout_add_seconds|idle_add)\s*\(/g;

const matchAll = (src, re) => [...src.matchAll(new RegExp(re.source, re.flags))];

/**
 * Files that own GLib sources, with the function that must release them.
 * `teardown` is matched as a body: the id has to appear inside it.
 */
const OWNERS = [
  { file: "lib/extension/window.js", teardown: "_removeSignals" },
  { file: "lib/shared/config-sync.js", teardown: "destroy" },
];

/** Extract one method body by brace matching from its `  name(` declaration. */
function methodBody(src, name) {
  const start = src.search(new RegExp(`\\n  ${name}\\s*\\([^)]*\\)\\s*\\{`));
  expect(start, `method ${name} not found`).toBeGreaterThan(-1);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe("GLib source-id teardown hygiene", () => {
  for (const { file, teardown } of OWNERS) {
    describe(file, () => {
      const src = read(file);
      const ids = [...new Set(matchAll(src, OWNED_ID_ASSIGN).map((m) => m[1]))];
      const body = methodBody(src, teardown);

      it(`stores at least one source id`, () => {
        // Sanity: if the pattern stops matching, the fence below is vacuous.
        expect(ids.length).toBeGreaterThan(0);
      });

      it.each(ids)(`clears %s in ${teardown}()`, (id) => {
        expect(
          body.includes(id),
          `${file}: ${id} is armed from a GLib source but never released in ${teardown}(). ` +
            `A source still queued when the extension is disabled fires into a dead ` +
            `object. Add it to ${teardown}() (via _clearTimeoutId where available).`
        ).toBe(true);
      });
    });
  }

  // The per-window source lives on the Meta.Window, not on a manager, so it is
  // released in the disable() sweep over tracked windows rather than in
  // _removeSignals. Pinned separately so the sweep cannot quietly go away.
  it("releases the per-window stacked-raise source in disable()", () => {
    const body = methodBody(read("lib/extension/window.js"), "disable");
    expect(body).toContain("_forgeStackTimeoutId");
    expect(body).toContain("GLib.Source.remove");
  });

  // Every site must route its id somewhere. A bare `GLib.timeout_add(...)` as a
  // statement is unreleasable by construction — the same shape no-untracked-connect
  // rejects for signals.
  it("has no fire-and-forget GLib source anywhere in lib/", () => {
    const files = [
      "lib/extension/window.js",
      "lib/extension/tree.js",
      "lib/extension/focus.js",
      "lib/extension/workspace.js",
      "lib/shared/config-sync.js",
      "lib/prefs/widgets.js",
    ];
    for (const file of files) {
      const src = read(file);
      for (const m of matchAll(src, ANY_SOURCE_ADD)) {
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        const prefix = src.slice(lineStart, m.index).trim();
        expect(
          prefix.endsWith("=") || prefix.endsWith("(") || prefix.endsWith("return"),
          `${file}: GLib source at offset ${m.index} discards its id ` +
            `(line starts with "${prefix}") — it can never be released`
        ).toBe(true);
      }
    }
  });
});
