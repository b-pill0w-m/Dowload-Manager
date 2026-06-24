import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { checkDesktopHealth, sendDetectedItem } from "./api.js";
import type { ActiveTabDetectedItemsResponse, ExtensionDetectedItem } from "./types.js";
import "./popup.css";

function Popup() {
  const [state, setState] = useState<ActiveTabDetectedItemsResponse>({
    tabId: null,
    tabTitle: "Loading",
    items: [],
  });
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
    void checkDesktopHealth().then(setConnected);
  }, []);

  async function refresh() {
    const response = await chrome.runtime.sendMessage({ type: "get-active-tab-items" }) as ActiveTabDetectedItemsResponse;
    setState(response);
  }

  async function clear() {
    const response = await chrome.runtime.sendMessage({ type: "clear-active-tab-items" }) as ActiveTabDetectedItemsResponse;
    setState(response);
    setMessage("");
  }

  async function send(item: ExtensionDetectedItem) {
    setMessage("");
    try {
      await sendDetectedItem(item);
      setConnected(true);
      setMessage("Sent to app");
    } catch (error) {
      setConnected(false);
      setMessage(error instanceof Error ? error.message : "Unable to send item");
    }
  }

  return (
    <main>
      <header>
        <h1>Download Manager</h1>
        <span className={connected ? "health ok" : "health"}>{connected ? "App online" : "App offline"}</span>
      </header>
      <section className="tab-title" title={state.tabTitle}>{state.tabTitle}</section>
      {message && <div className="message">{message}</div>}
      <section className="items">
        {state.items.length === 0 && <div className="empty">No downloadable requests detected.</div>}
        {state.items.map((item) => (
          <article key={item.id}>
            <strong title={item.fileName}>{item.fileName}</strong>
            <span>{item.contentType}</span>
            <a href={item.url} target="_blank" rel="noreferrer" title={item.url}>{item.url}</a>
            <button type="button" onClick={() => void send(item)}>Send to App</button>
          </article>
        ))}
      </section>
      <footer>
        <button type="button" onClick={() => void refresh()}>Refresh</button>
        <button type="button" onClick={() => void clear()}>Clear</button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
