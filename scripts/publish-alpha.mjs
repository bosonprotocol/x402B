#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const getReleasePlan = require("@changesets/get-release-plan").default;

const ROOT = process.cwd();
const dryRun = process.argv.includes("--dry-run");

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

async function npmVersions(pkgName) {
  try {
    const { stdout } = await run("npm", ["view", pkgName, "versions", "--json"], { silent: true });
    const text = stdout.trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    if (err.stderr && err.stderr.includes("E404")) return [];
    throw err;
  }
}

function nextAlphaCounter(existing, baseVersion) {
  const re = new RegExp(`^${baseVersion.replace(/\./g, "\\.")}-alpha-(\\d+)$`);
  let max = -1;
  for (const v of existing) {
    const m = re.exec(v);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

async function workspaceMap() {
  const { stdout } = await run("pnpm", ["ls", "-r", "--depth=-1", "--json"], { silent: true });
  const list = JSON.parse(stdout);
  const map = new Map();
  for (const entry of list) {
    if (entry.name && entry.path) map.set(entry.name, entry.path);
  }
  return map;
}

async function main() {
  const plan = await getReleasePlan(ROOT);
  const affected = plan.releases.filter((r) => r.type !== "none");

  if (affected.length === 0) {
    console.log("No changesets queued — skipping alpha publish.");
    return;
  }

  const workspace = await workspaceMap();
  const writes = [];
  const filterArgs = [];

  for (const release of affected) {
    const pkgDir = workspace.get(release.name);
    if (!pkgDir) {
      throw new Error(`Could not locate workspace package: ${release.name}`);
    }
    const pkgJsonPath = join(pkgDir, "package.json");
    const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf8"));
    const baseVersion = pkgJson.version;
    const existing = await npmVersions(release.name);
    const counter = nextAlphaCounter(existing, baseVersion);
    const newVersion = `${baseVersion}-alpha-${counter}`;
    console.log(`${release.name}: ${baseVersion} -> ${newVersion}`);
    pkgJson.version = newVersion;
    writes.push({
      path: pkgJsonPath,
      content: JSON.stringify(pkgJson, null, 2) + "\n",
    });
    filterArgs.push("--filter", release.name);
  }

  if (dryRun) {
    console.log("Dry-run: skipping package.json writes and `pnpm publish` invocation.");
    return;
  }

  for (const { path, content } of writes) {
    await writeFile(path, content);
  }

  await run("pnpm", [
    "-r",
    ...filterArgs,
    "publish",
    "--tag",
    "alpha",
    "--no-git-checks",
    "--access",
    "public",
    "--provenance",
  ]);
}

main().catch((err) => {
  console.error(err.message ?? err);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
});
