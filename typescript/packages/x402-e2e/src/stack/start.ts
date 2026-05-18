import { run } from "./exec.js";
import { COMPOSE_FILE } from "./paths.js";
import { waitForStackReady, type WaitForReadyOptions } from "./readiness.js";

export interface StartStackOptions extends WaitForReadyOptions {
  /** When `true`, runs `docker compose pull` before `up`. Default: false. */
  pull?: boolean;
  /** When `true`, rebuilds images from local context before `up`. Default: false. */
  build?: boolean;
  /** When `true`, blocks until `waitForStackReady` resolves. Default: true. */
  waitForReady?: boolean;
}

/**
 * Bring up the canonical Boson stack + the three x402B services in
 * detached mode. Returns once Docker reports every container started
 * (`--wait`); set `waitForReady: false` to skip the contracts/subgraph
 * readiness probe (e.g. when you only need the IPFS + RPC pair up).
 */
export async function startStack(options: StartStackOptions = {}): Promise<void> {
  if (options.pull === true) {
    await run("docker", ["compose", "-f", COMPOSE_FILE, "pull"]);
  }

  const upArgs = ["compose", "-f", COMPOSE_FILE, "up", "-d", "--wait"];
  if (options.build === true) upArgs.push("--build");
  await run("docker", upArgs);

  if (options.waitForReady !== false) {
    await waitForStackReady(options);
  }
}
