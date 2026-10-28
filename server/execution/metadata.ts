import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { ROOT } from "../config.js";

function git(...args: string[]) {
  try {
    return execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/** Source and CI identity of a run, recorded so results can be tied to an exact build. */
export function sourceInfo() {
  return {
    commitSha: process.env.GITHUB_SHA ?? git("rev-parse", "HEAD"),
    ref: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git("rev-parse", "--abbrev-ref", "HEAD"),
    dirty: process.env.GITHUB_ACTIONS ? false : git("status", "--porcelain") ? true : git("rev-parse", "HEAD") ? false : null,
    ci: process.env.GITHUB_ACTIONS
      ? { system: "github-actions", event: process.env.GITHUB_EVENT_NAME, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, repository: process.env.GITHUB_REPOSITORY }
      : null,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
}

export const hashOf = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 12);
