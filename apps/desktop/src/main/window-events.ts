export interface SendableWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
  };
}

export function sendToWindowIfAlive(
  window: SendableWindow | null,
  channel: string,
  payload: unknown,
): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send(channel, payload);
}
