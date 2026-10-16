// theming-config:G012: pins the reset guards of AppearancePage._createColorOptionWidget
// (forge-el84, forge-ijl3). The stylesheet has no .tiled rule, so defaultPalette.tiled is
// all undefined. Each test was shown red under the mutation named in its describe.
import { describe, it, expect, vi, afterEach } from "vitest";
import Gtk from "gi://Gtk";
import { AppearancePage } from "../../../lib/prefs/appearance.js";
import { File, Settings } from "../../mocks/gnome/Gio.js";

const css = `
.window-tiled-border {
  border-width: 3px;
  border-color: rgba(255, 0, 0, 1);
}
`;

afterEach(() => vi.restoreAllMocks());

function build() {
  vi.spyOn(File.prototype, "load_contents").mockImplementation(() => [
    true,
    new TextEncoder().encode(css),
    null,
  ]);
  const settings = new Settings();
  settings.set_uint("css-last-update", 0);
  const page = new AppearancePage({ settings, dir: new File("/mock") });
  expect(page.themeMgr.defaultPalette.tiled["border-width"]).toBeUndefined();
  const expander = page._createColorOptionWidget("window-tiled-border");
  const [colorRow, sizeRow] = expander._children;
  const reset = (row) => row._children.find((c) => c instanceof Gtk.Button);
  return { page, colorReset: reset(colorRow), sizeReset: reset(sizeRow) };
}

describe("forge-el84: border reset without a source rule", () => {
  it("keeps the border width instead of writing undefinedpx", () => {
    const { page, sizeReset } = build();
    sizeReset.emit("clicked");
    const theme = page.themeMgr;
    expect(theme.getCssProperty(".window-tiled-border", "border-width").value).toBe("3px");
  });
});

describe("forge-el84 / forge-ijl3: colour reset without a source rule", () => {
  it("does not throw out of the clicked handler", () => {
    const { colorReset } = build();
    expect(() => colorReset.emit("clicked")).not.toThrow();
  });
});
