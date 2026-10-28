/**
 * Control the system under test from the command line.
 *
 *   npm run sut -- status
 *   npm run sut -- fix BUG-05            # turn a bug off (simulate a fix)
 *   npm run sut -- break BUG-05          # turn it back on
 *   npm run sut -- bugs all|none         # all bugs on / off
 *   npm run sut -- layout classic|refresh
 *   npm run sut -- reset                 # reseed demo data
 */
import { readSutConfig, writeSutConfig } from "../server/config.js";

const [cmd, arg] = process.argv.slice(2);
const cfg = readSutConfig();

switch (cmd) {
  case "fix":
  case "break": {
    if (!arg || !(arg in cfg.bugs)) throw new Error(`Unknown bug id "${arg}". Known: ${Object.keys(cfg.bugs).join(", ")}`);
    cfg.bugs[arg] = cmd === "break";
    writeSutConfig(cfg);
    break;
  }
  case "bugs": {
    if (arg !== "all" && arg !== "none") throw new Error("Use: bugs all|none");
    for (const k of Object.keys(cfg.bugs)) cfg.bugs[k] = arg === "all";
    writeSutConfig(cfg);
    break;
  }
  case "layout": {
    if (arg !== "classic" && arg !== "refresh") throw new Error("Use: layout classic|refresh");
    cfg.uiVariant = arg;
    writeSutConfig(cfg);
    break;
  }
  case "reset": {
    const { resetDemoData } = await import("../server/database/demo-db.js");
    resetDemoData();
    console.log("Demo data reset to seed.");
    break;
  }
  case "status":
  case undefined:
    break;
  default:
    throw new Error(`Unknown command "${cmd}".`);
}

const now = readSutConfig();
console.log(`UI variant: ${now.uiVariant}`);
for (const [id, on] of Object.entries(now.bugs)) console.log(`${id}: ${on ? "ACTIVE" : "fixed"}`);
