// Mock Gio namespace
import { withSignals } from "../helpers/signalMixin.js";
import { Variant } from "./GLib.js";

// GVariant type string for a plain JS value, for get_value() on a key that was
// stored through a typed setter. Covers the four types the Forge schemas use.
function inferType(value) {
  if (typeof value === "boolean") return "b";
  if (typeof value === "string") return "s";
  if (Array.isArray(value)) return "as";
  if (Number.isInteger(value)) return "u";
  return "d";
}

export class File {
  constructor(path) {
    this.path = path;
    // Permission model so tests can exercise read-only stylesheet handling (Bug #312).
    this._writable = true;
    this._mode = 0o644;
  }

  static new_for_path(path) {
    return new File(path);
  }

  get_path() {
    return this.path;
  }

  get_parent() {
    const parts = this.path.split("/");
    parts.pop();
    return new File(parts.join("/"));
  }

  get_child(name) {
    return new File(`${this.path}/${name}`);
  }

  query_exists(cancellable) {
    // Mock - assume files exist
    return true;
  }

  make_directory_with_parents(cancellable) {
    // Mock directory creation
    return true;
  }

  load_contents(cancellable) {
    // Mock file loading - return empty content. Real Gio hands back a Uint8Array
    // (GLib.Bytes data), so decode via TextDecoder works; returning a bare string
    // here would diverge from production.
    return [true, new TextEncoder().encode(""), null];
  }

  replace_contents(contents, etag, make_backup, flags, cancellable) {
    // Mock file writing — fails on a read-only file, like the real Gio (Bug #312).
    return this._writable ? [true, null] : [false, null];
  }

  copy(destination, flags, cancellable, progressCallback) {
    // Model Gio's perm handling: by default a copy preserves the source's mode;
    // TARGET_DEFAULT_PERMS makes the destination use the (writable) umask default.
    if (destination && typeof destination === "object") {
      if ((flags & FileCopyFlags.TARGET_DEFAULT_PERMS) !== 0) {
        destination._writable = true;
        destination._mode = 0o644;
      } else {
        destination._writable = this._writable;
        destination._mode = this._mode;
      }
    }
    return true;
  }

  set_attribute_uint32(attribute, value, flags, cancellable) {
    if (attribute === "unix::mode") {
      this._mode = value;
      this._writable = (value & 0o200) !== 0; // owner-write bit
    }
    return true;
  }

  create(flags, cancellable) {
    // Mock file creation - return a mock output stream
    return {
      write_all: (contents, cancellable) => {
        // Mock write operation
        return [true, contents.length];
      },
      close: (cancellable) => true,
    };
  }
}

// object -> Map(property -> end the binding), what Settings.unbind reaches.
const bindings = new WeakMap();

export class Settings extends withSignals() {
  constructor(schema_id) {
    super();
    this.schema_id = schema_id;
    this._settings = new Map();
  }

  static new(schema_id) {
    return new Settings(schema_id);
  }

  get_boolean(key) {
    return this._settings.get(key) || false;
  }

  set_boolean(key, value) {
    this._settings.set(key, value);
  }

  get_int(key) {
    return this._settings.get(key) || 0;
  }

  set_int(key, value) {
    this._settings.set(key, value);
  }

  get_string(key) {
    return this._settings.get(key) || "";
  }

  set_string(key, value) {
    this._settings.set(key, value);
  }

  get_strv(key) {
    return this._settings.get(key) || [];
  }

  set_strv(key, value) {
    this._settings.set(key, value);
  }

  get_uint(key) {
    return this._settings.get(key) || 0;
  }

  set_uint(key, value) {
    this._settings.set(key, value);
  }

  // Real get_value returns a GVariant; typed getters keep reading the plain value,
  // so a Variant stored through set_value is unpacked on the way in.
  get_value(key) {
    const value = this._settings.get(key);
    return value instanceof Variant ? value : new Variant(inferType(value), value);
  }

  set_value(key, value) {
    this._settings.set(key, value instanceof Variant ? value.recursiveUnpack() : value);
  }

  // Schema view: the keys that hold a value (a real schema lists every key it defines).
  list_keys() {
    return [...this._settings.keys()];
  }

  // The current value stands in for the schema default, which keeps the type checks
  // (bindingKeysOf, the cheatsheet) working. A test of a schema-default branch must
  // stub it, as bug-nouuu7 does, or it passes without testing anything.
  get_default_value(key) {
    return this._settings.has(key) ? this.get_value(key) : null;
  }

  /**
   * Two-way boolean property binding, like the real GSettings.bind: the key is pushed
   * into the property now and on every change, and a notify::<property> from the object
   * writes the key back. Like GLib, destroy() does not end it: only Settings.unbind does
   * (or the object's finalize, which the mock does not model).
   */
  bind(key, object, property, _flags) {
    object[property] = this.get_boolean(key);
    const fromSettings = this.connect(`changed::${key}`, () => {
      object[property] = this.get_boolean(key);
    });
    const fromObject =
      typeof object.connect === "function"
        ? object.connect(`notify::${property}`, () => {
            if (object[property] !== this.get_boolean(key)) this.set_boolean(key, object[property]);
          })
        : null;
    if (!bindings.has(object)) bindings.set(object, new Map());
    bindings.get(object).set(property, () => {
      this.disconnect(fromSettings);
      if (fromObject !== null) object.disconnect(fromObject);
    });
  }

  static unbind(object, property) {
    bindings.get(object)?.get(property)?.();
    bindings.get(object)?.delete(property);
  }
}

export const SettingsBindFlags = {
  DEFAULT: 0,
  GET: 1 << 0,
  SET: 1 << 1,
  NO_SENSITIVITY: 1 << 2,
  GET_NO_CHANGES: 1 << 3,
  INVERT_BOOLEAN: 1 << 4,
};

export const FileCreateFlags = {
  NONE: 0,
  PRIVATE: 1 << 0,
  REPLACE_DESTINATION: 1 << 1,
};

export const FileQueryInfoFlags = {
  NONE: 0,
  NOFOLLOW_SYMLINKS: 1 << 0,
};

export const FileCopyFlags = {
  NONE: 0,
  OVERWRITE: 1 << 0,
  BACKUP: 1 << 1,
  NOFOLLOW_SYMLINKS: 1 << 2,
  ALL_METADATA: 1 << 3,
  NO_FALLBACK_FOR_MOVE: 1 << 4,
  TARGET_DEFAULT_PERMS: 1 << 5,
};

export default {
  File,
  Settings,
  SettingsBindFlags,
  FileCreateFlags,
  FileCopyFlags,
  FileQueryInfoFlags,
};
