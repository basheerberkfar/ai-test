import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@ui": path.resolve(here, "../shared") } },
  server: {
    port: 5174,
    strictPort: true,
    proxy: { "/api/lab": "http://localhost:4000", "/artifacts": "http://localhost:4000" },
  },
});
