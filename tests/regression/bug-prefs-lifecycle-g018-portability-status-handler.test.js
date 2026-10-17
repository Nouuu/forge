// prefs-lifecycle:G018: PortabilityPage connected a bare "changed", so _updateStatus (two file
// lookups, two get_uint64) ran on every Forge key write while the page was open.
// Fix: connect only changed::config-last-import and changed::config-last-export, the two keys
// whose writes can change what the status shows, keep both ids and disconnect them in
// vfunc_unroot.
import { describe, it, expect, vi, afterEach } from "vitest";
import { PortabilityPage } from "../../lib/prefs/portability.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

const KEYS = ["config-last-import", "config-last-export"];

afterEach(() => vi.restoreAllMocks());

// GSettings emits "changed" with the key as detail: both "changed" and "changed::<key>" fire.
function write(settings, key) {
  settings.emit("changed", settings, key);
  settings.emit(`changed::${key}`, settings, key);
}

function openPage() {
  const settings = new Settings();
  const page = new PortabilityPage({
    settings,
    kbdSettings: new Settings(),
    dir: new File("/mock"),
    window: null,
  });
  return { settings, page, updateStatus: vi.spyOn(page, "_updateStatus") };
}

describe("prefs-lifecycle:G018: the portability status refreshes only on its own keys", () => {
  it("a write of an unrelated key does not refresh the status", () => {
    const { settings, updateStatus } = openPage();
    write(settings, "window-gap-size");
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("a write of either timestamp refreshes the status once", () => {
    const { settings, updateStatus } = openPage();
    for (const key of KEYS) {
      updateStatus.mockClear();
      write(settings, key);
      expect(updateStatus).toHaveBeenCalledTimes(1);
    }
  });

  it("vfunc_unroot disconnects both handlers", () => {
    const { settings, page, updateStatus } = openPage();
    page.vfunc_unroot();
    for (const key of KEYS) write(settings, key);
    expect(updateStatus).not.toHaveBeenCalled();
    for (const signal of ["changed", ...KEYS.map((key) => `changed::${key}`)]) {
      expect(settings.getHandlerCount(signal)).toBe(0);
    }
  });
});
