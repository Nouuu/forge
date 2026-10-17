import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Cheatsheet } from "../../lib/extension/cheatsheet.js";
import { installGnomeGlobals } from "../mocks/helpers/index.js";

/**
 * input-commands:G-006: the cheatsheet showed a raw <Control>.
 *
 * _formatShortcut mapped only <Super>, <Shift>, <Ctrl>, <Alt> and <Primary>. The
 * preferences save accelerators through Gtk.accelerator_name, which emits <Control>
 * (and <Hyper>, <Meta>), so a shortcut set in the preferences showed as "<Control>q".
 *
 * Fix: <Ctrl>, <Control> and <Primary> render as "Ctrl+", then any other <Name> renders
 * as "Name+". Shipped defaults render as before.
 */
describe("input-commands:G-006: the cheatsheet renders every modifier GTK can save", () => {
  let ctx;
  let cheatsheet;

  beforeEach(() => {
    ctx = installGnomeGlobals({ display: { monitorCount: 1 } });
    cheatsheet = new Cheatsheet({ kbdSettings: {} });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("renders <Control><Shift>Return as Ctrl+Shift+Return", () => {
    expect(cheatsheet._formatShortcut("<Control><Shift>Return")).toBe("Ctrl+Shift+Return");
  });

  it("renders <Primary> and <Ctrl> as Ctrl+", () => {
    expect(cheatsheet._formatShortcut("<Primary>q")).toBe("Ctrl+q");
    expect(cheatsheet._formatShortcut("<Ctrl>q")).toBe("Ctrl+q");
  });

  it("keeps Super+ and the arrow glyph", () => {
    expect(cheatsheet._formatShortcut("<Super>Left")).toBe("Super+←");
  });

  it("renders every modifier Gtk.accelerator_name emits without markup", () => {
    for (const mod of ["Shift", "Control", "Alt", "Super", "Hyper", "Meta"]) {
      const out = cheatsheet._formatShortcut(`<${mod}>x`);
      expect(out).not.toContain("<");
      expect(out).toBe(`${mod === "Control" ? "Ctrl" : mod}+x`);
    }
  });
});
