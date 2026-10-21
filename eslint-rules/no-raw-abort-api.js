/*
 * Repo-local ESLint rule (close-spec-gaps:N18): no-raw-abort-api
 *
 * Bans the Mutter calls that abort GNOME Shell (a g_assert or a NULL dereference, not a
 * catchable exception) on a window or monitor state they do not expect, everywhere EXCEPT
 * the module that guards them (lib/extension/utils.js). Every other call site goes through
 * the guarded helpers there (getWorkAreaSafe, getWorkspaceWorkArea, getWorkAreaForMonitor,
 * moveToMonitorSafe), which check each precondition before the raw call.
 *
 * The four names are banned by property name, whatever the receiver: Meta.Workspace shares
 * `get_work_area_for_monitor` with Meta.Window, and a lint rule has no types to tell them
 * apart. The helper names are camelCase, so there is no collision with a correct call site.
 *
 * A bare reference (`const f = win.move_to_monitor;`, `.call`, `.bind`, a callback argument)
 * is reported like a call: it can be invoked later with the guard skipped, and nothing outside
 * utils.js has a reason to touch these members.
 *
 * shortcut: computed (`win["move_to_monitor"]`) and destructured access is not matched, same as
 * no-raw-maximize-api; upgrade if the codebase ever writes one.
 *
 * utils.js is exempted wholesale (it is the one file allowed to touch the raw APIs).
 */

"use strict";

const ABORT_METHODS = new Set([
  "get_work_area_for_monitor",
  "get_work_area_current_monitor",
  "get_work_area_all_monitors",
  "move_to_monitor",
]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban the Mutter calls that abort the shell outside lib/extension/utils.js; use its guarded helpers instead.",
    },
    schema: [],
    messages: {
      rawAbort:
        "Do not use the raw Mutter `{{name}}`: it aborts GNOME Shell on a window or monitor state it does not expect. Use a guarded helper from lib/extension/utils.js (getWorkAreaSafe, getWorkspaceWorkArea, getWorkAreaForMonitor, moveToMonitorSafe).",
    },
  },

  create(context) {
    // Exempt the guarded module itself. Normalize separators, then match the repo-relative
    // path, so an unrelated utils.js in another directory is not exempted.
    const normalized = context.filename.replace(/\\/g, "/");
    if (normalized.endsWith("lib/extension/utils.js")) {
      return {};
    }

    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== "Identifier") return;
        const name = node.property.name;
        if (ABORT_METHODS.has(name)) {
          context.report({ node: node.property, messageId: "rawAbort", data: { name } });
        }
      },
    };
  },
};
