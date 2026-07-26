import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DialogHost } from "./dialogs";
import { StoreProvider } from "./store";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <App />
      <DialogHost />
    </StoreProvider>
  </StrictMode>,
);
