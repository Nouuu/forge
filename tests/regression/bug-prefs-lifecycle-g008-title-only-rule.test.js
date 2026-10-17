// prefs-lifecycle:G008: onAddHandler returned on an empty Window Class, so the Add dialog could not
// create a title-only rule although the shell, sortFloatOverrides and floatRowSubtitle handle one.
// Fix: reject only when both fields are empty, save { wmTitle, mode } with no wmClass key, and
// rebuild the list through the same path as Reset so the new row is labelled and sorted as on open.
// close-spec-gaps:N09: the dialog still titled the title field "Window Title (optional)", as if
// the class were required. Fix: plain field titles and a group description that asks for a
// class, a title or both.
import { describe, it, expect, vi, afterEach } from "vitest";
import { FloatingPage } from "../../lib/prefs/floating.js";
import { File, Settings } from "../mocks/gnome/Gio.js";
import { installFileStore } from "../mocks/helpers/index.js";

const USER = "/home/test/.config/forge/config/windows.json";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const store = installFileStore({
    [USER]: JSON.stringify({ overrides: [{ wmClass: "Alpha", mode: "float" }] }),
    "/mock/config/windows.json": JSON.stringify({ overrides: [] }),
  });
  const page = new FloatingPage({ settings: new Settings(), dir: new File("/mock") });
  page._root = { add_toast: () => {} };
  const saved = () => JSON.parse(store.files.get(USER)).overrides;
  return { page, saved };
}

describe("Add dialog title-only rules", () => {
  it("saves a title-only rule without a wmClass key and lists it as Title-only rule", () => {
    const { page, saved } = setup();
    page.wmTitleEntry.set_text("Picture-in-Picture");

    page.onAddHandler();

    expect(saved()).toContainEqual({ wmTitle: "Picture-in-Picture", mode: "float" });
    expect(Object.keys(saved().find((o) => o.wmTitle))).not.toContain("wmClass");
    const row = page.rows.find((r) => r.get_title() === "Picture-in-Picture");
    expect(row.get_subtitle()).toBe("Title-only rule");
    expect(page.rows).toHaveLength(2);
    expect(page.wmTitleEntry.get_text()).toBe("");
  });

  it("close-spec-gaps:N09: the dialog asks for a class, a title or both", () => {
    const { page } = setup();
    const group = page._children.find((g) => g.title === "Add Floating Window");

    expect(page.wmClassEntry.get_title()).toBe("Window Class");
    expect(page.wmTitleEntry.get_title()).toBe("Window Title");
    expect(group.description).toBe(
      "Add a rule to exclude windows from tiling by window class, title, or both. " +
        "Use xprop WM_CLASS to find window class."
    );
  });

  it("rejects both fields empty: error class, nothing saved", () => {
    const { page, saved } = setup();
    const before = saved();

    page.onAddHandler();

    expect(page.wmClassEntry.get_css_classes()).toContain("error");
    expect(saved()).toEqual(before);
    expect(page.rows).toHaveLength(1);
  });

  it("does not add a duplicate title-only rule", () => {
    const { page, saved } = setup();
    page.wmTitleEntry.set_text("Picture-in-Picture");
    page.onAddHandler();
    page.wmTitleEntry.set_text("Picture-in-Picture");

    page.onAddHandler();

    expect(saved().filter((o) => o.wmTitle === "Picture-in-Picture")).toHaveLength(1);
    expect(page.rows).toHaveLength(2);
  });
});
