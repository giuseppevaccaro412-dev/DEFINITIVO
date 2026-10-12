// Il ponte va caricato per primo: deve intercettare le richieste dei programmi
// prima di ogni altra cosa (su Vercel resta inattivo).
import "./ponte-artifact.js";
import "./chiave-unica.js";
import "./cattura-download.js";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
