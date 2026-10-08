import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Nouuu/forge#13: the e2e bridge's liveResizeBegin() replaces display.get_focus_window and
 * the tree's render() to drive a resize grab, then calls _handleGrabOpBegin. If that call
 * threw, _liveResize was never set, so liveResizeEnd() could not restore either patch and
 * the rest of the e2e session ran with them.
 *
 * Fix: a throw from the grab start restores both patches before it propagates.
 */
describe("Nouuu/forge#13: liveResizeBegin restores its patches when the grab start throws", () => {
  afterEach(() => {
    delete globalThis._forgeTestBridge;
  });

  it("puts back get_focus_window and tree.render", () => {
    const src = readFileSync(new URL("../e2e/framework/bridge.js", import.meta.url), "utf8");
    const win = (x) => ({ get_frame_rect: () => ({ x, y: 0, width: 100, height: 100 }) });
    const focus = () => null;
    const render = () => {};
    const wm = {
      tree: { render },
      _handleGrabOpBegin() {
        throw new Error("grab start failed");
      },
    };
    const display = { get_focus_window: focus };
    const shellGlobal = {
      display,
      workspace_manager: {
        get_active_workspace: () => ({ list_windows: () => [win(0), win(100)] }),
      },
    };
    const Main = { extensionManager: { lookup: () => ({ stateObj: { extWm: wm } }) } };
    const imports = { gi: { Meta: { GrabOp: { RESIZING_E: 1 } }, Clutter: {}, St: {} } };
    new Function("imports", "Main", "global", src)(imports, Main, shellGlobal);

    expect(() => globalThis._forgeTestBridge.liveResizeBegin()).toThrow("grab start failed");
    expect(display.get_focus_window).toBe(focus);
    expect(wm.tree.render).toBe(render);
  });
});
