import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug forge-l64o: the settings "changed" switch had a case for workspace-skip-tile
 * (force re-render) but NONE for its sibling monitor-skip-tile, and a bare default
 * break. So editing "Non-tiling monitors" in prefs did nothing until an unrelated
 * render, while the adjacent "Non-tiling workspaces" field applied instantly —
 * making the setting look broken.
 *
 * Fix: add a monitor-skip-tile case beside workspace-skip-tile.
 *
 * The same omission exists for seven appearance keys that lib/prefs/appearance.js
 * exposes but the switch never routes — see the second test below. monitor-skip-tile
 * was one instance of a switch that is incomplete, not the whole defect.
 */
describe("Bug forge-l64o: settings changes reach the render pipeline", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("re-renders (forced) on monitor-skip-tile, matching workspace-skip-tile", () => {
    const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm()._onSettingsChanged("monitor-skip-tile");
    expect(renderSpy).toHaveBeenCalledWith("monitor-skip-tile", true);

    // Sibling control: workspace-skip-tile already behaved this way.
    wm()._onSettingsChanged("workspace-skip-tile");
    expect(renderSpy).toHaveBeenCalledWith("workspace-skip-tile", true);

    // Routing control: an unhandled key hits the default break and does not render.
    renderSpy.mockClear();
    wm()._onSettingsChanged("resize-amount");
    expect(renderSpy).not.toHaveBeenCalled();
  });

  // Same defect, other keys. Each of these is a control in lib/prefs/appearance.js
  // whose value is only ever read DURING a render, so without a case the edit sits
  // invisible until an unrelated event happens to re-render — the l64o symptom.
  it.each([
    ["window-margin-top", "lib/extension/tree.js:2411"],
    ["window-margin-right", "lib/extension/tree.js:2411"],
    ["window-margin-bottom", "lib/extension/tree.js:2411"],
    ["window-margin-left", "lib/extension/tree.js:2411"],
    ["window-maximize-on-single", "lib/extension/window.js:1723"],
    ["split-border-toggle", "lib/extension/decoration.js:112"],
    ["focus-border-radius", "lib/extension/decoration.js:248"],
  ])("re-renders on %s (read at %s)", (key) => {
    const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm()._onSettingsChanged(key);

    expect(renderSpy).toHaveBeenCalledWith(key);
  });

  // window-overrides-reload-trigger is the key prefs writes after editing a float
  // rule. The handler refreshed the windowProps cache but scheduled no render, and
  // the rules are only consulted from processFloats -> isFloatingExempt ->
  // _classifyTileOverrides during a render — so an edited rule sat inert.
  it("re-renders after reloading window overrides", () => {
    const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    const reloadSpy = vi.spyOn(wm(), "reloadWindowOverrides").mockImplementation(() => {});

    wm()._onSettingsChanged("window-overrides-reload-trigger");

    expect(reloadSpy).toHaveBeenCalledWith(false);
    expect(renderSpy).toHaveBeenCalledWith("window-overrides-reload-trigger");
  });

  it("still ignores keys that are read on demand rather than during a render", () => {
    const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    // These are consulted at the moment they are used (window creation, drag,
    // command execution), so a render on change would be wasted work.
    for (const key of ["resize-amount", "default-window-layout", "dnd-center-layout"]) {
      wm()._onSettingsChanged(key);
    }

    expect(renderSpy).not.toHaveBeenCalled();
  });
});
