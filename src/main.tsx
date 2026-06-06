import React from "react";
import ReactDOM from "react-dom/client";
import { OmnistonProvider } from "@ston-fi/omniston-sdk-react";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import App from "./App";
import { omniston } from "./omniston-live";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={`${window.location.origin}/tonconnect-manifest.json`}>
      <OmnistonProvider omniston={omniston}>
        <App />
      </OmnistonProvider>
    </TonConnectUIProvider>
  </React.StrictMode>,
);
