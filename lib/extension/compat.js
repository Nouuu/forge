/*
 * This file is part of the Forge extension for GNOME
 *
 * Mutter API version-dispatch shims. All Meta.Window APIs that drifted
 * between supported Mutter releases are centralized here. Callers import
 * as `import * as Compat from "./compat.js"` and use Compat.<shim>(window).
 *
 * See docs/dev/compat.md for the per-release API drift map and the shim recipe
 * (memory forge-version-shim-recipe keeps the behavioral guardrails).
 */

import Meta from "gi://Meta";
import Clutter from "gi://Clutter";

import { SHELL_MAJOR } from "./shell-version.js";

export const IS_MUTTER_47_PLUS = SHELL_MAJOR >= 47;
export const IS_MUTTER_48_PLUS = SHELL_MAJOR >= 48;
export const IS_MUTTER_49_PLUS = SHELL_MAJOR >= 49;
export const IS_MUTTER_50_PLUS = SHELL_MAJOR >= 50;

/** True on a Wayland compositor. Mutter 50 dropped the X11 backend and the predicate. */
export function isWaylandCompositor() {
  return IS_MUTTER_50_PLUS || Meta.is_wayland_compositor();
}

/**
 * Construct/assign params for an St.BoxLayout direction. St ships with GNOME Shell, same
 * major as Mutter. `orientation` exists from 48; `vertical` is gone on 51, where an
 * unknown construct property throws.
 */
export function boxOrientation(vertical) {
  return IS_MUTTER_48_PLUS
    ? { orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL }
    : { vertical };
}

export function isMaximized(metaWindow) {
  if (IS_MUTTER_49_PLUS) return metaWindow.is_maximized();
  return metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH;
}

export function isNotMaximized(metaWindow) {
  if (IS_MUTTER_49_PLUS) return !metaWindow.is_maximized();
  return metaWindow.get_maximized() === 0;
}

export function maximize(metaWindow, flags = Meta.MaximizeFlags.BOTH) {
  if (IS_MUTTER_49_PLUS) {
    metaWindow.set_maximize_flags(flags);
    metaWindow.maximize();
  } else {
    metaWindow.maximize(flags);
  }
}

export function unmaximize(metaWindow) {
  if (IS_MUTTER_49_PLUS) {
    metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
    metaWindow.unmaximize();
  } else {
    metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
  }
}

export function getMaximizeFlags(metaWindow) {
  if (IS_MUTTER_49_PLUS) return metaWindow.get_maximize_flags();
  return metaWindow.get_maximized();
}

/**
 * forge-16ms: is_on_all_workspaces() reports the EFFECTIVE sticky state, which
 * Mutter sets implicitly for every window on a non-primary monitor under the GNOME
 * default workspaces-only-on-primary=true — with no user intent.
 * is_always_on_all_workspaces() returns only the user-requested pin (the "Always on
 * Visible Workspace" toggle), which is what float-by-role actually wants. The method
 * has been in Mutter since well before GNOME 45; fall back to the effective state on
 * any build that lacks it.
 */
export function isAlwaysOnAllWorkspaces(metaWindow) {
  if (typeof metaWindow.is_always_on_all_workspaces === "function") {
    return metaWindow.is_always_on_all_workspaces();
  }
  return metaWindow.is_on_all_workspaces();
}

/**
 * The default Clutter seat, or null.
 *
 * MetaBackend has no public get_default_seat on any supported release; the seat lives on
 * the ClutterBackend. From 47 it is reached through the stage's ClutterContext, the path
 * GNOME Shell itself uses (Clutter.get_default_backend() is gone on 51); 45-46 have no
 * context and use Clutter.get_default_backend().
 *
 * Its caller (warpPointerToNodeWindow) sits inside the focus handler, so a throw here
 * would break focus on EVERY window change, not just the pointer warp. Degrade to null.
 */
export function getDefaultSeat() {
  try {
    // `global` is GNOME Shell's injected global, not a TS-visible binding.
    const backend = IS_MUTTER_47_PLUS
      ? /** @type {any} */ (globalThis).global.stage.context.get_backend()
      : Clutter.get_default_backend();
    return backend.get_default_seat() ?? null;
  } catch (e) {
    return null;
  }
}
