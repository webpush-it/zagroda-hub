#!/usr/bin/env node
/*
 * Post-edit quality hook (local only).
 * Wired from .claude/settings.local.json → PostToolUse(Write|Edit):
 *     { "command": "node .claude/hooks/post-edit.mjs", "timeout": 180000 }
 *
 * On every code edit it runs, scoped to the file that changed:
 *   1. eslint --fix   on the edited file only   (blocking → exit 2 on error)
 *   2. astro check     whole project            (blocking → exit 2 on error)
 *   3. vitest related  for the edited file       (informational, never blocks)
 *
 * Why a script and not inline shell: getting the edited file path REQUIRES
 * parsing the JSON payload Claude Code sends on stdin (there is no env var or
 * template for it). Inlining that into settings.json is unreadable, and jq is
 * not installed here — Node is guaranteed (this is a JS project).
 *
 * Exit codes (Claude Code PostToolUse): 2 surfaces the error back to Claude so
 * it self-corrects; 0 = clean / informational only.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const CODE_EXT = new Set([".ts", ".tsx", ".astro", ".js", ".jsx", ".mjs", ".cjs"]);
const isWin = process.platform === "win32";

// The hook payload arrives as JSON on stdin (fd 0). Strip a leading BOM — some
// shells prepend one when piping — then pull tool_input.file_path.
function editedFile() {
  try {
    let raw = readFileSync(0, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return JSON.parse(raw)?.tool_input?.file_path || "";
  } catch {
    return "";
  }
}

// shell:true so `npx` resolves through its .cmd shim on Windows.
function run(cmd, args) {
  const { status } = spawnSync(cmd, args, { stdio: "inherit", shell: isWin });
  return status === null ? 1 : status;
}

const file = editedFile();
const norm = file.replace(/\\/g, "/"); // normalize Windows separators
const ext = file.slice(file.lastIndexOf(".")).toLowerCase();

// Skip when there's nothing useful to check:
//   - non-code edits (.md, .json, context/, …)
//   - paths outside the lintable app tree. .claude/ tooling, dependencies and
//     build output are NOT part of the TS project, so eslint's projectService
//     throws a parse error on them — which would wrongly fail the hook.
const SKIP_DIR = /(^|\/)(\.claude|node_modules|dist|\.astro)\//;
if (!file || !CODE_EXT.has(ext) || SKIP_DIR.test(norm)) process.exit(0);

let blocking = 0;

// 1. Lint + autofix the edited file only (fast vs. linting the whole repo).
blocking |= run("npx", ["eslint", "--fix", "--quiet", file]);

// 2. Astro-aware typecheck. tsc --noEmit silently ignores .astro files, so
//    `astro check` is the correct gate (and the one test-plan §5 names).
blocking |= run("npx", ["astro", "check"]);

// 3. Related tests on edit — informational. --passWithNoTests keeps quiet when
//    nothing imports the file; a down local Supabase stack must not block every
//    edit, so test failures are shown but never set the blocking exit code.
run("npx", ["vitest", "related", file, "--run", "--passWithNoTests"]);

process.exit(blocking ? 2 : 0);
