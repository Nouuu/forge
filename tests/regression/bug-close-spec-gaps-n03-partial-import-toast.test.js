// close-spec-gaps:N03: PortabilityPage._importConfig toasted "Import failed" when every existing
// file reported false. Since theming-config:G010 a file reports false as soon as one key is
// rejected, so a lone settings.json with one refused key read as a failure though its other
// keys landed.
// Fix: importAll also returns `applied`, the count of writes GSettings accepted. The toast says
// imported when no existing file failed, else partially imported when applied > 0, else failed.
import { describe, it, expect, vi, afterEach } from "vitest";
import { PortabilityPage } from "../../lib/prefs/portability.js";
import { File, Settings } from "../mocks/gnome/Gio.js";
import { installFileStore } from "../mocks/helpers/index.js";

const CONF = "/home/test/.config/forge/config";
const SETTINGS = `${CONF}/settings.json`;
const KEYBINDINGS = `${CONF}/keybindings.json`;
const APPEARANCE = { appearance: { "window-gap-size": 99, "window-margin-top": 7 } };
const KEYS = { bindings: { "window-focus-right": ["<Super>k"] } };

afterEach(() => vi.restoreAllMocks());

function importWith(seed, refuse = []) {
  installFileStore(seed);
  const settings = new Settings();
  settings.set_uint("window-gap-size", 4);
  settings.set_uint("window-margin-top", 0);
  const realSet = settings.set_value.bind(settings);
  settings.set_value = (key, v) => (refuse.includes(key) ? false : realSet(key, v));
  const kbdSettings = new Settings();
  kbdSettings.set_strv("window-focus-right", ["<Super>l"]);
  const toasts = [];
  const window = { add_toast: (t) => toasts.push(t.title) };
  const page = new PortabilityPage({ settings, kbdSettings, dir: new File("/mock"), window });
  page._importConfig();
  return toasts;
}

describe("a partly applied import is not a failure", () => {
  it("only settings.json, one key refused: partially imported", () => {
    const toasts = importWith({ [SETTINGS]: JSON.stringify(APPEARANCE) }, ["window-gap-size"]);
    expect(toasts).toEqual(["Configuration partially imported"]);
  });

  it("only settings.json, unparsable: failed", () => {
    expect(importWith({ [SETTINGS]: "{ not json" })).toEqual(["Import failed"]);
  });

  it("only settings.json, every key refused: failed", () => {
    const toasts = importWith({ [SETTINGS]: JSON.stringify(APPEARANCE) }, [
      "window-gap-size",
      "window-margin-top",
    ]);
    expect(toasts).toEqual(["Import failed"]);
  });

  it("both files fine: imported successfully", () => {
    const toasts = importWith({
      [SETTINGS]: JSON.stringify(APPEARANCE),
      [KEYBINDINGS]: JSON.stringify(KEYS),
    });
    expect(toasts).toEqual(["Configuration imported successfully"]);
  });
});
