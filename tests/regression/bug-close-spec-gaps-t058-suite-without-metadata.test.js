import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync } from "node:fs";
import Adw from "gi://Adw";
import config from "../../vitest.config.js";
import { developers } from "../mocks/metadata.js";
import { makeAboutButton } from "../../lib/prefs/settings.js";

/**
 * close-spec-gaps:T058: on a tree without lib/prefs/metadata.js (a fresh clone, or
 * make unit-test-docker, whose .dockerignore drops it), every test file that imports
 * lib/prefs/settings.js failed with "Failed to load url ./metadata.js".
 *
 * Root cause: make metadata generates that file and git ignores it. tests/setup.js
 * mocked it with vi.mock, but Vitest still resolves the import before it applies a
 * mock, and the resolve fails when the file is absent.
 *
 * Fix: vitest.config.js aliases the "./metadata.js" import to tests/mocks/metadata.js
 * under test.alias, which vitest.prefs.config.js inherits, so lib/prefs/settings.js
 * never reads the generated file in either run.
 */
describe("close-spec-gaps:T058: the suite loads without the generated prefs metadata", () => {
  afterEach(() => vi.restoreAllMocks());

  it("aliases the metadata import to a stub that exists", () => {
    const stub = config.test.alias["./metadata.js"];
    expect(stub).toMatch(/tests\/mocks\/metadata\.js$/);
    expect(existsSync(stub)).toBe(true);
  });

  it("gives lib/prefs/settings.js the stub, not lib/prefs/metadata.js", () => {
    const present = vi.spyOn(Adw.AboutWindow.prototype, "present");
    makeAboutButton(null, {}).emit("clicked");
    expect(present).toHaveBeenCalledTimes(1);
    expect(present.mock.contexts[0].developers).toBe(developers);
  });
});
