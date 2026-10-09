import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Repo-level check, run by the pre-commit hook. `git diff --cached` prints
// paths relative to the repository root whatever the working directory, so
// git and secretlint run from the repository root (this script's parent
// directory), where those paths resolve and where .secretlintrc.json sits.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const stagedFiles = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean);

if (stagedFiles.length === 0) {
  process.exit(0);
}

// On Windows `pnpm` is a `.cmd` shim, which Node only runs through a shell;
// elsewhere the call is exactly what it was. The staged paths are the
// repository's own (no spaces), so the shell sees each as one argument.
execFileSync("pnpm", ["exec", "secretlint", ...stagedFiles], {
  cwd: repoRoot,
  stdio: "inherit",
  ...(process.platform === "win32" ? { shell: true } : {}),
});
