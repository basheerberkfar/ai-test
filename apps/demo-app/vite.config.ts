import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const sutFile = path.resolve(here, "../../config/sut.json");

/**
 * Injects the current release configuration into index.html on every page load, so toggling
 * config/sut.json takes effect on refresh. Only neutral runtime settings reach the browser.
 */
function runtimeConfig(): Plugin {
  return {
    name: "demo-runtime-config",
    transformIndexHtml(html) {
      const sut = JSON.parse(fs.readFileSync(sutFile, "utf8"));
      const runtime = { layout: sut.uiVariant, submitGuard: !sut.bugs["BUG-01"] };
      return html.replace("<!--runtime-->", `<script>window.__RUNTIME__=${JSON.stringify(runtime)}</script>`);
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss(), runtimeConfig()],
  resolve: { alias: { "@ui": path.resolve(here, "../shared") } },
  server: {
    port: 5173,
    strictPort: true,
    // Only the demo API is reachable from the system under test.
    proxy: { "/api/demo": "http://localhost:4000" },
  },
});
