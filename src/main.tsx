import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/commissioner";
import "@/components/arc/foundation.css";
import "@/styles/tokens.css";
import "@/styles/shell.css";
import "@/styles/browser.css";
import "@/styles/settings.css";
import "@/styles/analytics.css";
import { AppProvider } from "@/app/context";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
