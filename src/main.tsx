import React from "react";
import ReactDOM from "react-dom/client";
import { OmnistonProvider } from "@ston-fi/omniston-sdk-react";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import App from "./App";
import { omniston } from "./omniston-live";
import { initializeTelegramMiniApp } from "./telegram";
import "./styles.css";

initializeTelegramMiniApp();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={`${window.location.origin}${import.meta.env.BASE_URL}tonconnect-manifest.json`}>
      <OmnistonProvider omniston={omniston}>
        <App />
      </OmnistonProvider>
    </TonConnectUIProvider>
  </React.StrictMode>,
);
