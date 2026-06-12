import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./styles.css";

installInteractionGuards();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

function installInteractionGuards() {
  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (shouldBlockShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { capture: true },
  );
}

function shouldBlockShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  if (key === "f12") {
    return true;
  }
  if (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key)) {
    return true;
  }
  if (event.metaKey && event.altKey && ["i", "j", "c"].includes(key)) {
    return true;
  }
  return event.ctrlKey && ["u", "s", "p"].includes(key);
}
