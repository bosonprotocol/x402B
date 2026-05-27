#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const PACKAGES_DIR = join(ROOT, "typescript", "packages");

function run(cmd, args, { silent = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c;
      if (!silent) process.stdout.write(c);
    });
    child.stderr.on("data", (c) => {
      stderr += c;
      if (!silent) process.stderr.write(c);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(
            Object.assign(new Error(`${cmd} exited ${code}`), {
              code,
              stdout,
              stderr,
            }),
          ),
    );
  });
}

async function listLocalTags() {
  const { stdout } = await run("git", ["tag", "--list"], { silent: true });
  return new Set(stdout.split(/\r?\n/).filter(Boolean));
}

async function readWorkspacePackages() {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const out = new Map();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(PACKAGES_DIR, e.name);
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      if (pkg.name) out.set(pkg.name, { dir, version: pkg.version, private: pkg.private });
    } catch {
      // ignore missing package.json
    }
  }
  return out;
}

async function extractChangelogSection(dir, version) {
  try {
    const content = await readFile(join(dir, "CHANGELOG.md"), "utf8");
    const lines = content.split(/\r?\n/);
    const header = `## ${version}`;
    const startIdx = lines.findIndex((l) => l.trim() === header);
    if (startIdx === -1) return "";
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        endIdx = i;
        break;
      }
    }
    return lines
      .slice(startIdx + 1, endIdx)
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

async function releaseExists(tag) {
  try {
    await run("gh", ["release", "view", tag], { silent: true });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const tagsBefore = await listLocalTags();

  console.log("Publishing to npm (changeset publish)...");
  await run("pnpm", ["exec", "changeset", "publish"]);

  const tagsAfter = await listLocalTags();
  const newTags = [...tagsAfter].filter((t) => !tagsBefore.has(t));

  if (newTags.length > 0) {
    console.log(`Pushing ${newTags.length} new tag(s) to origin...`);
    await run("git", ["push", "origin", ...newTags]);
  } else {
    console.log("No new tags created — backfilling any missing GitHub Releases.");
  }

  // Ensure a GitHub Release exists for every published workspace package at its
  // current version. Deriving the target tags from the version set (rather than
  // only the tags created during this run) keeps release creation idempotent:
  // a re-run after a partial failure backfills the releases that weren't
  // created, while skipping the ones that already exist.
  const pkgs = await readWorkspacePackages();
  for (const [name, pkg] of pkgs) {
    if (pkg.private || !pkg.version) continue;
    const tag = `${name}@${pkg.version}`;
    if (await releaseExists(tag)) {
      console.log(`GitHub Release already exists for ${tag} — skipping.`);
      continue;
    }
    const notes = (await extractChangelogSection(pkg.dir, pkg.version)) || `Release ${tag}.`;
    console.log(`Creating GitHub Release for ${tag}`);
    await run("gh", ["release", "create", tag, "--title", tag, "--notes", notes]);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
});
