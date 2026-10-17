// prefs-lifecycle:G012: FloatingPage.saveOverrides wrote { overrides: modified }, so the first
// Add, Remove or Reset dropped `$schema` and any hand-added top-level key of windows.json.
// Fix: saveOverrides reads configMgr.windowProps, sets overrides on it and saves that object.
// With a malformed user file the save is refused and the file is left as it is
// (close-spec-gaps:T045).
import { describe, it, expect, vi, afterEach } from "vitest";
import { FloatingPage } from "../../lib/prefs/floating.js";
import { File, Settings } from "../mocks/gnome/Gio.js";
import { installFileStore } from "../mocks/helpers/index.js";

const USER = "/home/test/.config/forge/config/windows.json";
const DEFAULT = "/mock/config/windows.json";
const SCHEMA = "https://example.test/windows.schema.json";
const float = (wmClass) => ({ wmClass, mode: "float" });

afterEach(() => vi.restoreAllMocks());

function setup(userText) {
  const store = installFileStore({
    [USER]: userText,
    [DEFAULT]: JSON.stringify({ $schema: SCHEMA, overrides: [float("Alpha")] }),
  });
  const page = new FloatingPage({ settings: new Settings(), dir: new File("/mock") });
  const toasts = [];
  page._root = { add_toast: (t) => toasts.push(t.title) };
  return { store, page, toasts };
}

describe("saves keep the other top-level fields", () => {
  it("Add and Remove keep $schema and a custom key", () => {
    const { store, page } = setup(
      JSON.stringify({ $schema: SCHEMA, custom: { a: 1 }, overrides: [float("Alpha")] })
    );
    page.wmClassEntry.set_text("Gamma");
    page.onAddHandler();
    let saved = JSON.parse(store.files.get(USER));
    expect(saved.$schema).toBe(SCHEMA);
    expect(saved.custom).toEqual({ a: 1 });
    expect(saved.overrides).toContainEqual(float("Gamma"));

    page.onRemoveHandler(float("Alpha"), page.rows[0]);
    saved = JSON.parse(store.files.get(USER));
    expect(saved.$schema).toBe(SCHEMA);
    expect(saved.custom).toEqual({ a: 1 });
    expect(saved.overrides).toEqual([float("Gamma")]);
  });

  it("a malformed user file is left unchanged and the save toasts (close-spec-gaps:T045)", () => {
    const { store, page, toasts } = setup("{ not json");
    page.wmClassEntry.set_text("Gamma");
    page.onAddHandler();
    expect(store.files.get(USER)).toBe("{ not json");
    expect(toasts).toEqual(["Could not save the window rules"]);
  });
});
