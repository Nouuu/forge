import { describe, it, expect } from "vitest";
import {
  SETTINGS_OVERRIDES,
  shouldApplyOverride,
  overridesGatedBy,
  overridesConflictingWithBindings,
  bindsAccelerator,
  reconcileAction,
} from "../../../lib/shared/gnome-overrides.js";

// Minimal fake exposing only get_boolean, like Forge's Gio.Settings.
const settingsWith = (values) => ({
  get_boolean: (key) => Boolean(values[key]),
});

// Minimal fake of the keybindings Gio.Settings: strv per key, [] when unset.
const kbdWith = (values) => ({
  get_strv: (key) => values[key] || [],
  list_keys: () => Object.keys(values),
  get_default_value: () => ({ get_type_string: () => "as" }),
});

describe("shouldApplyOverride (forge-9fo, forge-abk)", () => {
  const edgeTiling = SETTINGS_OVERRIDES.find((d) => d.key === "edge-tiling");
  const autoMaximize = SETTINGS_OVERRIDES.find((d) => d.key === "auto-maximize");

  it("models edge-tiling as gated by both disable-edge-tiling and tiling-mode-enabled", () => {
    expect(edgeTiling.gatedBy).toEqual(["disable-edge-tiling", "tiling-mode-enabled"]);
  });

  it("applies an array-gated override only when ALL its Forge settings are true", () => {
    expect(
      shouldApplyOverride(
        edgeTiling,
        settingsWith({ "disable-edge-tiling": true, "tiling-mode-enabled": true })
      )
    ).toBe(true);
  });

  it("skips an array-gated override when ANY of its Forge settings is false", () => {
    expect(
      shouldApplyOverride(
        edgeTiling,
        settingsWith({ "disable-edge-tiling": true, "tiling-mode-enabled": false })
      )
    ).toBe(false);
    expect(
      shouldApplyOverride(
        edgeTiling,
        settingsWith({ "disable-edge-tiling": false, "tiling-mode-enabled": true })
      )
    ).toBe(false);
  });

  it("always applies an ungated override regardless of settings", () => {
    expect(autoMaximize.gatedBy).toBeUndefined();
    expect(shouldApplyOverride(autoMaximize, settingsWith({}))).toBe(true);
  });

  it("leaves every override except edge-tiling ungated", () => {
    const gated = SETTINGS_OVERRIDES.filter((d) => d.gatedBy);
    expect(gated).toEqual([edgeTiling]);
  });
});

describe("shouldApplyOverride: binding-conflict gate (bug super-l-lock-cleared-without-binding)", () => {
  const screensaver = SETTINGS_OVERRIDES.find((d) => d.key === "screensaver");
  const noGate = settingsWith({});

  it("models the Super+L lock override as conflicting with the <Super>l accelerator", () => {
    expect(screensaver.conflictsWith).toBe("<Super>l");
    expect(overridesConflictingWithBindings()).toContain(screensaver);
  });

  it("models the four Super+arrow overrides as conflicting with the arrow accelerators", () => {
    const byKey = Object.fromEntries(
      overridesConflictingWithBindings().map((d) => [d.key, d.conflictsWith])
    );
    expect(byKey).toEqual({
      "toggle-tiled-left": "<Super>Left",
      "toggle-tiled-right": "<Super>Right",
      maximize: "<Super>Up",
      unmaximize: "<Super>Down",
      screensaver: "<Super>l",
      shortcut: "<Super>q",
    });
  });

  it("skips a Super+arrow override once the arrow is gone from Forge's focus bindings", () => {
    const maximize = SETTINGS_OVERRIDES.find((d) => d.key === "maximize");
    const arrows = kbdWith({ "window-focus-up": ["<Super>k", "<Super>Up"] });
    const vimOnly = kbdWith({ "window-focus-up": ["<Super>k"] });
    expect(shouldApplyOverride(maximize, noGate, arrows)).toBe(true);
    expect(shouldApplyOverride(maximize, noGate, vimOnly)).toBe(false);
  });

  it("applies while some Forge keybinding carries <Super>l (the shipped default)", () => {
    const kbd = kbdWith({ "window-focus-right": ["<Super>l", "<Super>Right"] });
    expect(bindsAccelerator(kbd, "<Super>l")).toBe(true);
    expect(shouldApplyOverride(screensaver, noGate, kbd)).toBe(true);
  });

  it("skips once no Forge keybinding carries <Super>l any more", () => {
    const kbd = kbdWith({ "window-focus-right": ["<Super>Right"] });
    expect(bindsAccelerator(kbd, "<Super>l")).toBe(false);
    expect(shouldApplyOverride(screensaver, noGate, kbd)).toBe(false);
  });

  it("does not count a different chord on the same key (<Ctrl><Super>l is not Super+L)", () => {
    const kbd = kbdWith({
      "window-focus-right": ["<Super>Right"],
      "window-resize-left-decrease": ["<Ctrl><Super>l"],
      "window-swap-right": ["<Shift><Super>l"],
    });
    expect(shouldApplyOverride(screensaver, noGate, kbd)).toBe(false);
  });

  it("leaves overrides without conflictsWith unaffected by the keybindings", () => {
    const autoMaximize = SETTINGS_OVERRIDES.find((d) => d.key === "auto-maximize");
    expect(shouldApplyOverride(autoMaximize, noGate, kbdWith({}))).toBe(true);
  });
});

describe("overridesGatedBy (forge-abk)", () => {
  it("returns the edge-tiling override for each of its gating keys", () => {
    expect(overridesGatedBy("tiling-mode-enabled").map((d) => d.key)).toEqual(["edge-tiling"]);
    expect(overridesGatedBy("disable-edge-tiling").map((d) => d.key)).toEqual(["edge-tiling"]);
  });

  it("returns nothing for a setting that gates no override", () => {
    expect(overridesGatedBy("not-a-gating-key")).toEqual([]);
  });
});

describe("reconcileAction (forge-abk)", () => {
  const edgeTiling = SETTINGS_OVERRIDES.find((d) => d.key === "edge-tiling");
  const bothOn = settingsWith({ "disable-edge-tiling": true, "tiling-mode-enabled": true });
  const tilingOff = settingsWith({ "disable-edge-tiling": true, "tiling-mode-enabled": false });

  it("applies when it should be active but is not yet saved", () => {
    expect(reconcileAction(edgeTiling, bothOn, false)).toBe("apply");
  });

  it("restores when it should be inactive but is currently saved", () => {
    expect(reconcileAction(edgeTiling, tilingOff, true)).toBe("restore");
  });

  it("is a no-op when already applied and still should apply", () => {
    expect(reconcileAction(edgeTiling, bothOn, true)).toBe("noop");
  });

  it("is a no-op when already restored and still should not apply", () => {
    expect(reconcileAction(edgeTiling, tilingOff, false)).toBe("noop");
  });

  it("restores the Super+L override once its conflicting binding is gone", () => {
    const screensaver = SETTINGS_OVERRIDES.find((d) => d.key === "screensaver");
    const unbound = kbdWith({ "window-focus-right": ["<Super>Right"] });
    const bound = kbdWith({ "window-focus-right": ["<Super>l"] });
    expect(reconcileAction(screensaver, bothOn, true, unbound)).toBe("restore");
    expect(reconcileAction(screensaver, bothOn, false, bound)).toBe("apply");
    expect(reconcileAction(screensaver, bothOn, true, bound)).toBe("noop");
  });
});
