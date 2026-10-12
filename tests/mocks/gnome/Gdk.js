// Mock Gdk namespace (prefs process only)

export class RGBA {
  constructor() {
    this.red = 0;
    this.green = 0;
    this.blue = 0;
    this.alpha = 0;
  }

  // Gdk.RGBA.parse takes a non-nullable const char*, so GJS throws on a non-string
  // instead of returning false (forge-el84, forge-ijl3).
  parse(spec) {
    if (typeof spec !== "string") throw new TypeError("Expected type utf8 for argument 'spec'");
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(spec.trim());
    const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(spec);
    if (hex) {
      const [r, g, b, a] = hex.slice(1).map((x) => (x === undefined ? 255 : parseInt(x, 16)));
      [this.red, this.green, this.blue, this.alpha] = [r / 255, g / 255, b / 255, a / 255];
    } else if (fn) {
      [this.red, this.green, this.blue] = fn.slice(1, 4).map((x) => Number(x) / 255);
      this.alpha = fn[4] === undefined ? 1 : Number(fn[4]);
    } else {
      return false;
    }
    return true;
  }

  copy() {
    return Object.assign(new RGBA(), this);
  }

  to_string() {
    const [r, g, b] = [this.red, this.green, this.blue].map((x) => Math.round(x * 255));
    return this.alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${this.alpha})`;
  }
}

const display = {};

export const Display = {
  get_default: () => display,
};

export default { RGBA, Display };
