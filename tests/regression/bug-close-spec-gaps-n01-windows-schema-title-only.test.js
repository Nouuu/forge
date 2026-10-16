// close-spec-gaps:N01: config/windows.schema.json required wmClass on every rule, yet the bundled
// windows.json ships a title-only rule and the Windows page writes them (prefs-lifecycle:G008).
// Fix: the rule item requires mode, plus one of wmClass or wmTitle (anyOf).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (f) => JSON.parse(readFileSync(new URL(`../../config/${f}`, import.meta.url), "utf8"));
const schema = read("windows.schema.json");
const item = schema.properties.overrides.items;

describe("windows.schema.json rule item", () => {
  it("requires mode and one of wmClass or wmTitle, not wmClass alone", () => {
    expect(item.required).toEqual(["mode"]);
    expect(item.anyOf).toEqual([{ required: ["wmClass"] }, { required: ["wmTitle"] }]);
  });

  it("is satisfied by every bundled rule", () => {
    const rules = read("windows.json").overrides;
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.mode).toBeDefined();
      expect(rule.wmClass !== undefined || rule.wmTitle !== undefined).toBe(true);
    }
  });
});
