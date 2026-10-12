import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Usata da CE e RF per scegliere dove inviare le chiamate a Claude
  // (vuota = proxy /api/anthropic dello stesso dominio).
  define: { __CLAUDE_ENDPOINT__: JSON.stringify(process.env.VITE_CLAUDE_ENDPOINT || "") },
});
