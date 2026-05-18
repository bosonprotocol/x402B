// Poll for the two "deploy.done" markers the upstream Boson stack
// drops once its automatic deploy step finishes:
//
//  - `/app/deploy.done`   inside `boson-protocol-node`  → contracts are deployed
//  - `/home/deploy.done`  inside `boson-subgraph`        → subgraph is deployed
//
// Mirrors the readiness check from
// https://github.com/bosonprotocol/core-components/blob/main/e2e/prepare-e2e-services.sh
// — same probe, same compose-aware execution path. Both deploys are
// idempotent and run automatically on container start; this helper
// just waits for them to finish.

import { run } from "./exec.js";
import { COMPOSE_FILE } from "./paths.js";

export interface WaitForReadyOptions {
  /** Maximum wall-clock to wait per probe before throwing. Default: 10 minutes. */
  timeoutMs?: number;
  /** Polling interval. Default: 15 seconds (matches the upstream script). */
  intervalMs?: number;
  /** Logger for human-readable progress lines. Default: `console.log`. */
  log?: (line: string) => void;
}

const DEFAULTS = {
  timeoutMs: 10 * 60_000,
  intervalMs: 15_000,
} as const;

async function probe(service: string, path: string): Promise<boolean> {
  const result = await run(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "exec", "-T", service, "ls", path],
    { silent: true, captureStdout: true, rejectOnNonZero: false },
  );
  return result.exitCode === 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollUntilReady(
  service: string,
  path: string,
  label: string,
  opts: Required<Omit<WaitForReadyOptions, "log">> & { log: (line: string) => void },
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  opts.log(`[stack] waiting for ${label}…`);
  // first check is immediate; subsequent attempts wait `intervalMs`.
  while (true) {
    if (await probe(service, path)) {
      opts.log(`[stack] ${label} ✅`);
      return;
    }
    if (Date.now() >= deadline) {
      break;
    }
    await sleep(opts.intervalMs);
  }
  throw new Error(
    `[stack] timed out after ${opts.timeoutMs / 1000}s waiting for ${label} (service=${service} path=${path})`,
  );
}

/** Resolve once both contracts and subgraph are deployed. Sequential by design — subgraph indexes the chain so contracts must finish first. */
export async function waitForStackReady(options: WaitForReadyOptions = {}): Promise<void> {
  const merged = {
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    intervalMs: options.intervalMs ?? DEFAULTS.intervalMs,
    log: options.log ?? ((line: string) => console.log(line)),
  };

  await pollUntilReady(
    "boson-protocol-node",
    "/app/deploy.done",
    "boson-protocol-node contracts to be deployed",
    merged,
  );
  await pollUntilReady("boson-subgraph", "/home/deploy.done", "boson-subgraph deploy", merged);
}
