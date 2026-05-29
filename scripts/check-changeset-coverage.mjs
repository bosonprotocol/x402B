#!/usr/bin/env node
// Fails when a PR changes a publishable workspace package but no queued
// changeset declares that package — i.e. the change would silently never be
// versioned or published (the class of miss that let PR #68 merge without an
// alpha). `changeset status` only checks that *some* changeset exists; this
// also checks the changeset names the *specific* packages that changed.
//
// Scope: only publishable packages (private packages and anything matched by a
// workspace glob that has no package.json are ignored), so docs-only or
// example-only / e2e-only PRs don't need a changeset.
//
// Escape hatch: set the `no-changeset` label on the PR (the workflow forwards
// it as HAS_OVERRIDE_LABEL=true) for a change that intentionally ships nothing.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, sep } from "node:path";

const ROOT = process.cwd();

// Kept in sync with pnpm-workspace.yaml. Both entries are single-level `<dir>/*`
// globs, so we just read each parent's immediate child directories.
const WORKSPACE_GLOB_PARENTS = ["typescript/packages", "examples"];

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

const toPosix = (p) => p.split(sep).join("/");

// All workspace packages -> { name, dir (posix, relative to ROOT), private }.
function workspacePackages() {
  const pkgs = [];
  for (const parent of WORKSPACE_GLOB_PARENTS) {
    const parentAbs = join(ROOT, parent);
    if (!existsSync(parentAbs)) continue;
    for (const entry of readdirSync(parentAbs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(parentAbs, entry.name, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      if (!pkg.name) continue;
      pkgs.push({ name: pkg.name, dir: `${parent}/${entry.name}`, private: pkg.private === true });
    }
  }
  return pkgs;
}

// Package names declared across every queued changeset's frontmatter.
function declaredPackages(dir) {
  const declared = new Set();
  if (!existsSync(dir)) return declared;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md") || file.toLowerCase() === "readme.md") continue;
    const content = readFileSync(join(dir, file), "utf8");
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^\s*["']?(@?[^"':]+?)["']?\s*:\s*(patch|minor|major)\s*$/);
      if (m) declared.add(m[1].trim());
    }
  }
  return declared;
}

function main() {
  if (process.env.HAS_OVERRIDE_LABEL === "true") {
    console.log("`no-changeset` label present — skipping changeset coverage check.");
    return;
  }

  const base = process.env.CHANGESET_BASE || "origin/main";
  // Three-dot: files changed on HEAD since it diverged from base (the PR's diff).
  const changedFiles = git(["diff", "--name-only", `${base}...HEAD`])
    .split(/\r?\n/)
    .filter(Boolean)
    .map(toPosix);

  // Longest dir first so a nested path resolves to its most specific package.
  const packages = workspacePackages().sort((a, b) => b.dir.length - a.dir.length);

  const changedPublishable = new Set();
  for (const file of changedFiles) {
    const pkg = packages.find((p) => file === p.dir || file.startsWith(p.dir + "/"));
    if (pkg && !pkg.private) changedPublishable.add(pkg.name);
  }

  if (changedPublishable.size === 0) {
    console.log("No publishable package changed — changeset not required.");
    return;
  }

  const declared = declaredPackages(join(ROOT, ".changeset"));
  const missing = [...changedPublishable].filter((n) => !declared.has(n)).sort();
  const extra = [...declared].filter((n) => !changedPublishable.has(n)).sort();

  console.log(`Base ref:               ${base}`);
  console.log(`Changed (publishable):  ${[...changedPublishable].sort().join(", ")}`);
  console.log(`Declared in changesets: ${[...declared].sort().join(", ") || "(none)"}`);

  if (extra.length) {
    console.warn(`\n⚠️  Declared but unchanged in this PR: ${extra.join(", ")}`);
  }

  if (missing.length) {
    console.error(
      `\n❌ These changed publishable packages have no changeset entry:\n` +
        missing.map((n) => `   - ${n}`).join("\n") +
        `\n\nRun \`pnpm changeset\` and select them. If this change intentionally\n` +
        `ships no release, add the \`no-changeset\` label to the PR instead.`,
    );
    process.exit(1);
  }

  console.log("\n✅ Every changed publishable package is covered by a changeset.");
}

main();
