import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import { Logger } from "../../lib/shared/logger.js";

/**
 * Bug prefs-lifecycle:G004: the prefs process never initialised the logger.
 * Logger.init(settings) ran only in extension.js enable(). The shell process and the
 * prefs process share no module state, so in prefs Logger had no settings and every
 * Logger.* call in lib/prefs was a no-op, even in a debug build.
 *
 * Fix: ForgeExtensionPreferences constructor calls Logger.init(this.settings) after
 * super(...). A production build still logs nothing (Logger#level returns OFF).
 */
let mockProduction = false;
vi.mock("../../lib/shared/settings.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    get production() {
      return mockProduction;
    },
  };
});

const { default: ForgeExtensionPreferences } = await import("../../prefs.js");

describe("Bug prefs-lifecycle:G004: prefs process initialises its logger", () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.fn();
    vi.stubGlobal("log", logSpy);
    const values = { "logging-enabled": true, "log-level": Logger.LOG_LEVELS.DEBUG };
    vi.spyOn(Gio.Settings, "new").mockReturnValue({
      get_boolean: (k) => values[k],
      get_uint: (k) => values[k],
    });
  });

  afterEach(() => {
    Logger.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a debug build logs through Logger after the prefs object is constructed", () => {
    mockProduction = false;
    new ForgeExtensionPreferences();
    Logger.debug("x");
    expect(logSpy).toHaveBeenCalledWith("[Forge] [DEBUG]", "x");
  });

  it("a production build still logs nothing", () => {
    mockProduction = true;
    new ForgeExtensionPreferences();
    Logger.debug("x");
    expect(logSpy).not.toHaveBeenCalled();
  });
});
