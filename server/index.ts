import express from "express";
import cors from "cors";
import { paths, settings } from "./config.js";
import { demoApi } from "./api/demo.js";
import { labApi } from "./api/lab.js";
import { recoverInterruptedRuns } from "./execution/runner.js";
import { closeBrowser } from "./browser/session.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// System under test API (proxied by the demo app on :5173).
app.use("/api/demo", demoApi);
// AI testing workspace API (proxied by the workspace on :5174 only).
app.use("/api/lab", cors({ origin: ["http://localhost:5174"] }), labApi);
// Screenshots and other run artifacts.
app.use("/artifacts", express.static(paths.artifacts, { maxAge: "1h" }));

recoverInterruptedRuns();

const server = app.listen(settings.port, () => {
  console.log(`[server] API listening on http://localhost:${settings.port}`);
  console.log(`[server] Demo app:          http://localhost:5173`);
  console.log(`[server] Testing workspace: http://localhost:5174`);
});

const shutdown = async () => {
  await closeBrowser();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
