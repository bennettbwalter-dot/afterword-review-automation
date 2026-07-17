import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api/v1/public": "http://127.0.0.1:4175",
      "/api": "http://127.0.0.1:4174",
      "/webhooks": "http://127.0.0.1:4175",
    },
  },
});
