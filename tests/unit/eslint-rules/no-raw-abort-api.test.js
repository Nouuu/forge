// close-spec-gaps:N18 (FR-022): Mutter aborts the shell on these four calls when a window has
// no workspace or no monitor, so only the guarded helpers in lib/extension/utils.js may make them.
import { RuleTester } from "eslint";
import rule from "../../../eslint-rules/no-raw-abort-api.js";

// ESLint 9 RuleTester uses global `describe`/`it`/`afterAll`, which vitest
// provides (globals: true). It requires FLAT `languageOptions`, not the legacy
// `parserOptions`.
const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// The set is pinned here on purpose: dropping a name from the rule fails this file.
const ABORT_API = [
  "get_work_area_for_monitor",
  "get_work_area_current_monitor",
  "get_work_area_all_monitors",
  "move_to_monitor",
];

const raw = (name) => [{ messageId: "rawAbort", data: { name } }];

ruleTester.run("no-raw-abort-api", rule, {
  valid: [
    // utils.js owns the guarded helpers: the one file allowed the raw calls.
    ...ABORT_API.map((name) => ({
      code: `metaWindow.${name}(0);`,
      filename: "lib/extension/utils.js",
    })),
    // ESLint hands the rule an absolute path, with backslashes on Windows.
    {
      code: "workspace.get_work_area_for_monitor(0);",
      filename: "/home/dev/forge/lib/extension/utils.js",
    },
    {
      code: "workspace.get_work_area_for_monitor(0);",
      filename: "C:\\dev\\forge\\lib\\extension\\utils.js",
    },
    // The guarded helpers are the correct call sites; their camelCase names do not collide.
    { code: "Utils.getWorkAreaSafe(metaWindow);", filename: "lib/extension/window.js" },
    { code: "Utils.getWorkspaceWorkArea(workspace, 0);", filename: "lib/extension/window.js" },
    { code: "Utils.getWorkAreaForMonitor(metaWindow, 0);", filename: "lib/extension/tree.js" },
    { code: "Utils.moveToMonitorSafe(metaWindow, 0);", filename: "lib/extension/window.js" },
    // Unrelated members are untouched.
    { code: "metaWindow.get_frame_rect();", filename: "lib/extension/window.js" },
    { code: "metaWindow.get_monitor();", filename: "lib/extension/window.js" },
    { code: "global.display.get_monitor_geometry(0);", filename: "lib/extension/window.js" },
    // A computed key or a private member is not the Mutter member.
    { code: "table[move_to_monitor];", filename: "lib/extension/window.js" },
    {
      code: "class A { #move_to_monitor() {} run() { this.#move_to_monitor(); } }",
      filename: "lib/extension/window.js",
    },
  ],
  invalid: [
    // Each name, on a Meta.Window receiver.
    ...ABORT_API.map((name) => ({
      code: `metaWindow.${name}(0);`,
      filename: "lib/extension/window.js",
      errors: raw(name),
    })),
    {
      // Meta.Workspace shares get_work_area_for_monitor with Meta.Window; the receiver is not
      // told apart, so a workspace receiver is reported too.
      code: "global.workspace_manager.get_active_workspace().get_work_area_for_monitor(i);",
      filename: "lib/extension/tree.js",
      errors: raw("get_work_area_for_monitor"),
    },
    {
      code: "metaWindow.get_workspace().get_work_area_for_monitor(i);",
      filename: "lib/extension/window.js",
      errors: raw("get_work_area_for_monitor"),
    },
    {
      // Optional-call form.
      code: "x?.get_work_area_for_monitor?.(i);",
      filename: "lib/extension/window.js",
      errors: raw("get_work_area_for_monitor"),
    },
    {
      // A bare reference is reported: it can be called later through an alias, `.call` or
      // `.bind`, with the guard skipped, and nothing outside utils.js has a reason to touch it.
      code: "const move = metaWindow.move_to_monitor;",
      filename: "lib/extension/window.js",
      errors: raw("move_to_monitor"),
    },
    {
      code: "metaWindow.move_to_monitor.call(metaWindow, 1);",
      filename: "lib/extension/window.js",
      errors: raw("move_to_monitor"),
    },
    {
      code: "windows.forEach(metaWindow.get_work_area_current_monitor, metaWindow);",
      filename: "lib/extension/window.js",
      errors: raw("get_work_area_current_monitor"),
    },
    {
      // extension.js and prefs.js are linted too.
      code: "metaWindow.move_to_monitor(1);",
      filename: "extension.js",
      errors: raw("move_to_monitor"),
    },
    {
      // Only lib/extension/utils.js is exempt, not any file called utils.js.
      code: "metaWindow.move_to_monitor(1);",
      filename: "lib/prefs/utils.js",
      errors: raw("move_to_monitor"),
    },
  ],
});
