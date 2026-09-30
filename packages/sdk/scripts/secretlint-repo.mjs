import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Repo-level check: it scans every tracked file in the WORKSPACE, not just
// this package. The script lives in packages/sdk/scripts, so both git and
// secretlint run from the workspace root three levels up — that is where
// `git ls-files` lists every path and where .secretlintrc.json sits.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .map((file) => file.trim())
  .filter(Boolean);

if (trackedFiles.length === 0) {
  process.exit(0);
}

execFileSync("pnpm", ["exec", "secretlint", ...trackedFiles], {
  cwd: repoRoot,
  stdio: "inherit",
});
