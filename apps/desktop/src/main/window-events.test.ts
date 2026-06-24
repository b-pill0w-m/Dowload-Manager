import { describe, expect, test, vi } from "vitest";
import { sendToWindowIfAlive } from "./window-events.js";

describe("main window event delivery", () => {
  test("does not send after the window has been destroyed", () => {
    const send = vi.fn(() => {
      throw new Error("Object has been destroyed");
    });
    const window = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    };

    expect(() => sendToWindowIfAlive(window, "downloads:progress", { id: "1" })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  test("does not send after webContents has been destroyed", () => {
    const send = vi.fn(() => {
      throw new Error("Object has been destroyed");
    });
    const window = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => true,
        send,
      },
    };

    expect(() => sendToWindowIfAlive(window, "downloads:progress", { id: "1" })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  test("sends when the window is alive", () => {
    const send = vi.fn();
    const window = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    };

    sendToWindowIfAlive(window, "downloads:progress", { id: "1" });

    expect(send).toHaveBeenCalledWith("downloads:progress", { id: "1" });
  });
});
