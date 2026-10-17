import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/extension/indicator.js", () => ({
  FeatureIndicator: class FeatureIndicator {
    quickSettingsItems = [];
    destroy() {}
  },
  FeatureMenuToggle: vi.fn(function FeatureMenuToggle() {
    this.destroy = vi.fn();
  }),
}));

import ForgeExtension from "../../extension.js";

/**
 * prefs-lifecycle:G017. Root cause: disable() nulled _gnomeSettings only inside
 * `if (this._savedSettings)`, so the cache outlived a teardown whose saved list
 * was already gone. Fix: the null assignment sits below the `if`.
 */
describe("prefs-lifecycle:G017: disable() always drops _gnomeSettings", () => {
  it("nulls _gnomeSettings when _savedSettings is already null", () => {
    const ext = new ForgeExtension();
    ext._savedSettings = null;
    ext._gnomeSettings = new Map([["x", {}]]);

    ext.disable();

    expect(ext._gnomeSettings).toBeNull();
  });
});
