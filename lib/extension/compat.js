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

export const IS_MUTTER_49_PLUS = SHELL_MAJOR >= 49;

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
 * Capability-probed rather than version-dispatched, because unlike the Meta.Window
 * shims above there is no documented cutoff to branch on — only two accessors that
 * have both existed and both been the "current" one at different points:
 * `global.backend.get_default_seat()` is Shell's own, `Clutter.get_default_backend()`
 * is Clutter's. Prefer Shell's and fall back.
 *
 * This is the one Clutter API Forge calls outside compat, and its caller
 * (warpPointerToNodeWindow) sits inside the focus handler — so a throw here breaks
 * focus on EVERY window change, not just the pointer warp it was doing. The setting
 * that reaches it (`move-pointer-focus-enabled`) appears nowhere in tests/e2e, so
 * this path has never run against a real shell on any supported GNOME version.
 * Degrade to null instead of throwing.
 */
export function getDefaultSeat() {
  try {
    // `global` is GNOME Shell's injected global, not a TS-visible binding — reach it
    // through globalThis with a cast rather than assuming it exists at type level.
    const shell = /** @type {any} */ (globalThis).global;
    const shellSeat = shell?.backend?.get_default_seat?.();
    if (shellSeat) return shellSeat;
  } catch (e) {
    // fall through to the Clutter accessor
  }
  // One guard, not two: the try/catch already covers an accessor that is missing
  // (TypeError) as well as one that throws, so optional chaining on top of it would
  // be dead defensive code.
  try {
    return Clutter.get_default_backend().get_default_seat() ?? null;
  } catch (e) {
    return null;
  }
}
