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
      if (pkg.name) out.set(pkg.name, { dir, version: pkg.version });
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

function parseTag(tag) {
  // Scoped: @scope/name@version  -> last '@' separates name from version
  const idx = tag.lastIndexOf("@");
  if (idx <= 0) return null;
  return { name: tag.slice(0, idx), version: tag.slice(idx + 1) };
}

async function main() {
  const tagsBefore = await listLocalTags();

  console.log("Publishing to npm (changeset publish)...");
  await run("pnpm", ["exec", "changeset", "publish"]);

  const tagsAfter = await listLocalTags();
  const newTags = [...tagsAfter].filter((t) => !tagsBefore.has(t));

  if (newTags.length === 0) {
    console.log("No new tags created — nothing published.");
    return;
  }

  console.log(`Pushing ${newTags.length} new tag(s) to origin...`);
  await run("git", ["push", "origin", "--tags"]);

  const pkgs = await readWorkspacePackages();

  for (const tag of newTags) {
    const parsed = parseTag(tag);
    if (!parsed) {
      console.log(`Skipping unparseable tag: ${tag}`);
      continue;
    }
    const pkg = pkgs.get(parsed.name);
    if (!pkg) {
      console.log(`Skipping tag ${tag} — package not found in workspace.`);
      continue;
    }
    const notes = (await extractChangelogSection(pkg.dir, parsed.version)) || `Release ${tag}.`;
    console.log(`Creating GitHub Release for ${tag}`);
    await run("gh", ["release", "create", tag, "--title", tag, "--notes", notes]);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
});
