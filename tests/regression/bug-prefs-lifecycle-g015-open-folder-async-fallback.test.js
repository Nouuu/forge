// prefs-lifecycle:G015: PortabilityPage._openConfigDir called Gtk.FileLauncher.launch with
// no callback. A failure reported through the async result got no xdg-open fallback and no
// toast; only a synchronous throw did.
// Fix: one local fallback(), called from the synchronous catch and from the launch callback
// when launch_finish throws. A dismissed app chooser (Gtk.DialogError.DISMISSED) is the
// user's choice, so it gets no fallback.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { PortabilityPage } from "../../lib/prefs/portability.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

const CONF = `${GLib.get_user_config_dir()}/forge`;

beforeEach(() => GLib.spawn_command_line_async.mockClear());
afterEach(() => vi.restoreAllMocks());

// The launch callback runs after launch() returns, as GIO calls back from the main loop.
const settle = () => new Promise((resolve) => setTimeout(resolve));

function failLaunch(code) {
  vi.spyOn(Gtk.FileLauncher.prototype, "launch_finish").mockImplementation(() => {
    throw new GLib.Error(Gtk.DialogError, code, "launch failed");
  });
}

async function openFolder() {
  const window = { add_toast: vi.fn() };
  const page = new PortabilityPage({
    settings: new Settings(),
    kbdSettings: new Settings(),
    dir: new File("/mock"),
    window,
  });
  page._openConfigDir();
  await settle();
  return window.add_toast.mock.calls.map(([toast]) => toast.title);
}

describe("prefs-lifecycle:G015: Open folder falls back when the launch fails late", () => {
  it("an async launch failure runs xdg-open on the config folder", async () => {
    failLaunch(Gtk.DialogError.FAILED);
    expect(await openFolder()).toEqual([]);
    expect(GLib.spawn_command_line_async.mock.calls).toEqual([[`xdg-open "${CONF}"`]]);
  });

  it("a failed fallback toasts once", async () => {
    failLaunch(Gtk.DialogError.FAILED);
    GLib.spawn_command_line_async.mockImplementationOnce(() => {
      throw new Error("no xdg-open");
    });
    expect(await openFolder()).toEqual(["Failed to open config directory"]);
  });

  it("a successful launch spawns nothing", async () => {
    expect(await openFolder()).toEqual([]);
    expect(GLib.spawn_command_line_async).not.toHaveBeenCalled();
  });

  it("a dismissed app chooser does nothing", async () => {
    failLaunch(Gtk.DialogError.DISMISSED);
    expect(await openFolder()).toEqual([]);
    expect(GLib.spawn_command_line_async).not.toHaveBeenCalled();
  });
});
