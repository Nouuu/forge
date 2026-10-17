import { vi } from "vitest";
// Mock GLib namespace

export function getenv(variable) {
  // Return mock environment variables
  const mockEnv = {
    HOME: "/home/test",
    USER: "testuser",
    SHELL: "/bin/bash",
  };
  return mockEnv[variable] || null;
}

export function get_home_dir() {
  return "/home/test";
}

export function get_user_data_dir() {
  return "/home/test/.local/share";
}

export function get_user_config_dir() {
  return "/home/test/.config";
}

export function build_filenamev(paths) {
  return paths.join("/");
}

export function file_test(file, test) {
  // Mock file test - always return true for simplicity
  return true;
}

export const FileTest = {
  EXISTS: 1 << 0,
  IS_REGULAR: 1 << 1,
  IS_SYMLINK: 1 << 2,
  IS_DIR: 1 << 3,
  IS_EXECUTABLE: 1 << 4,
};

export const PRIORITY_DEFAULT = 0;
export const PRIORITY_DEFAULT_IDLE = 200;
export const PRIORITY_HIGH = -100;
export const PRIORITY_LOW = 100;

export const SOURCE_REMOVE = false;

export function timeout_add(priority, interval, callback) {
  // Mock timeout - return a fake ID
  return Math.random();
}

export function idle_add(priority, callback) {
  // Mock idle_add - execute callback immediately in tests
  if (typeof callback === "function") {
    callback();
  }
  // The source has already run, so no id stays pending (a non-zero id here made
  // renderTree skip every later render).
  return 0;
}

export function source_remove(id) {
  // Mock source removal
  return true;
}

export const Source = {
  remove: (id) => true,
};

export function mkdir_with_parents(path, mode) {
  // Mock directory creation - return 0 for success
  return 0;
}

/**
 * Spawn is a no-op that records its argument: the keybinding callbacks that use it
 * (prefs-app-launch, prefs-lock-screen) are guarded against a throw, and the guard
 * is only testable if the mock can be made to throw on demand.
 */
export const spawn_command_line_async = vi.fn(() => true);

/**
 * Minimal GLib.Variant: a type string and a value. Every unpack flavour returns
 * the plain JS value, which is what the real one does for the b/u/s/as types the
 * Forge schemas use.
 */
export class Variant {
  constructor(typeString, value) {
    this._type = typeString;
    this._value = value;
    // Like GJS: ('b', "false") is true, ('u', "5") is 5, ('u', "abc") and ('u', -1) throw.
    if (typeString === "b") this._value = Boolean(value);
    if (typeString === "u") {
      const n = Number(value);
      if (!(n >= 0 && n <= 0xffffffff)) throw new TypeError("value is out of range for uint32");
      this._value = Math.trunc(n);
    }
  }

  static new(typeString, value) {
    return new Variant(typeString, value);
  }

  get_type_string() {
    return this._type;
  }

  // Like GJS: unpack() opens one level, so an array type yields an array of Variants;
  // deepUnpack() and recursiveUnpack() give plain values for the types Forge uses.
  unpack() {
    if (this._type.startsWith("a") && Array.isArray(this._value))
      return this._value.map((v) => new Variant(this._type.slice(1), v));
    return this._value;
  }

  deepUnpack() {
    return this._value;
  }

  recursiveUnpack() {
    return this._value;
  }

  equal(other) {
    return (
      other instanceof Variant &&
      this._type === other._type &&
      JSON.stringify(this._value) === JSON.stringify(other._value)
    );
  }
}

// GLib.Error as GJS throws it: a domain (an error enum such as Gtk.DialogError) and a code.
class GError extends globalThis.Error {
  constructor(domain, code, message) {
    super(message);
    this.domain = domain;
    this.code = code;
  }

  matches(domain, code) {
    return this.domain === domain && this.code === code;
  }
}

export { GError as Error };

export default {
  Error: GError,
  getenv,
  spawn_command_line_async,
  get_home_dir,
  get_user_data_dir,
  get_user_config_dir,
  build_filenamev,
  file_test,
  FileTest,
  PRIORITY_DEFAULT,
  PRIORITY_DEFAULT_IDLE,
  PRIORITY_HIGH,
  PRIORITY_LOW,
  SOURCE_REMOVE,
  timeout_add,
  idle_add,
  source_remove,
  Source,
  mkdir_with_parents,
  Variant,
};
