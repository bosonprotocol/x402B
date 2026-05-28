import { run } from "./exec.js";
import { COMPOSE_FILE } from "./paths.js";

export interface StopStackOptions {
  /** When `true`, deletes the named volumes (resets the chain + subgraph + IPFS). Default: true. */
  volumes?: boolean;
  /** When `true`, also removes images built by `compose up --build`. Default: false. */
  removeImages?: boolean;
}

/** Tear down the stack. Mirrors `docker compose down [-v] [--rmi local]`. */
export async function stopStack(options: StopStackOptions = {}): Promise<void> {
  const args = ["compose", "-f", COMPOSE_FILE, "down"];
  if (options.volumes !== false) args.push("-v");
  if (options.removeImages === true) args.push("--rmi", "local");
  await run("docker", args);
}
