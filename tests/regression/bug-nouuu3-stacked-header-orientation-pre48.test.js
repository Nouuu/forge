import { describe, it, expect, vi, afterEach } from "vitest";
import Clutter from "gi://Clutter";

/**
 * Nouuu/forge#3: stacked containers lay their title tabs out horizontally on GNOME 45-47.
 *
 * Root cause: d9261b5 ("GNOME 50 orientation") replaced `decoration.vertical = true` with
 * `decoration.orientation = Clutter.Orientation.VERTICAL` for every release. St.BoxLayout
 * only has `orientation` from GNOME 48, so on 45-47 the write sets a JS expando and the
 * header box keeps its default horizontal direction. The e2e probe in
 * test_workflow_stacked.py read that same expando back, so it never failed.
 *
 * Fix: Tree._ensureDecoration and _createDecoration apply Compat.boxOrientation(), which
 * returns `{ vertical }` before 48 and `{ orientation }` from 48.
 */
async function loadTreeFixture(packageVersion) {
  vi.resetModules();
  vi.doMock("resource:///org/gnome/shell/misc/config.js", () => ({
    PACKAGE_VERSION: packageVersion,
  }));
  const { createTreeFixture } = await import("../mocks/helpers/index.js");
  const { Node, NODE_TYPES, LAYOUT_TYPES } = await import("../../lib/extension/tree.js");
  const St = (await import("gi://St")).default;
  const ctx = createTreeFixture({ fullExtWm: true });
  const container = new Node(NODE_TYPES.CON, new St.Bin());
  container.layout = LAYOUT_TYPES.STACKED;
  return { ctx, container };
}

describe("Nouuu/forge#3: stacked header orientation before GNOME 48", () => {
  let ctx;

  afterEach(() => {
    ctx?.cleanup?.();
    vi.doUnmock("resource:///org/gnome/shell/misc/config.js");
  });

  it("sets `vertical` on a GNOME 47 header box, not an `orientation` expando", async () => {
    let container;
    ({ ctx, container } = await loadTreeFixture("47.0"));
    // A 45-47 St.BoxLayout: `vertical` is its only direction property.
    container.decoration = { vertical: false };

    ctx.tree._ensureDecoration(container, Clutter.Orientation.VERTICAL);

    expect(container.decoration.vertical).toBe(true);
    expect(container.decoration).not.toHaveProperty("orientation");
  });

  it("sets `orientation` on GNOME 48", async () => {
    let container;
    ({ ctx, container } = await loadTreeFixture("48.0"));

    ctx.tree._ensureDecoration(container, Clutter.Orientation.VERTICAL);

    expect(container.decoration.orientation).toBe(Clutter.Orientation.VERTICAL);
  });
});
