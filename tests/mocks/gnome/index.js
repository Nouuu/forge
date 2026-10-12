// Export all GNOME mocks

import * as MetaMock from "./Meta.js";
import * as GLibMock from "./GLib.js";
import * as GioMock from "./Gio.js";
import * as ShellMock from "./Shell.js";
import * as StMock from "./St.js";
import * as ClutterMock from "./Clutter.js";
import * as GObjectMock from "./GObject.js";
import * as GtkMock from "./Gtk.js";
import * as AdwMock from "./Adw.js";
import * as GdkMock from "./Gdk.js";

export const Meta = MetaMock;
export const GLib = GLibMock;
export const Gio = GioMock;
export const Shell = ShellMock;
export const St = StMock;
export const Clutter = ClutterMock;
export const GObject = GObjectMock;
export const Gtk = GtkMock;
export const Adw = AdwMock;
export const Gdk = GdkMock;

export default {
  Meta,
  GLib,
  Gio,
  Shell,
  St,
  Clutter,
  GObject,
  Gtk,
  Adw,
  Gdk,
};
