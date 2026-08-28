import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./auth.css";
import "./scan.css";
import "./content-generator.css";
import "./brand.css";
import "./onboarding.css";
import "./autosave.css";
import "./social.css";
import "./mobile-a11y.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
