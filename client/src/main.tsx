import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  const path = window.location.pathname;
  // Help links must also work when opened directly by support or App Review.
  if (/^\/help(?:\/[^/]+)?\/?$/.test(path)) {
    window.history.replaceState(null, "", `/#${path.replace(/\/$/, "")}${window.location.search}`);
  } else {
    window.location.hash = "#/";
  }
}

createRoot(document.getElementById("root")!).render(<App />);
