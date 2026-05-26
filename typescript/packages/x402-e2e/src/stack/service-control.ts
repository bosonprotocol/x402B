// Per-service Docker control for chaos-injection scenarios.
//
// `start.ts` / `stop.ts` own the WHOLE-stack lifecycle (the
// `globalSetup` contract). The helpers here target a single compose
// service so operational tests can simulate a container dying,
// restarting, or being temporarily paused mid-flow. Examples:
//
//   - F1: hard-kill `x402b-facilitator-http`, restart, verify recovery.
//   - F2: pause `boson-subgraph` for a window to force indexer lag.
//
// Service names are the YAML keys in `compose.yaml` — the docker compose
// CLI accepts the service name and derives the running container by
// project name (implicit, derived from the compose-file directory).
// Whole-stack helpers in `start.ts` / `stop.ts` use the same implicit
// project name, so service-control commands always target the same
// containers the suite booted.
//
// Every helper rejects on a non-zero exit so callers in `afterEach`
// blocks can wrap in `try/finally` and surface the original failure.

import { run } from "./exec.js";
import { COMPOSE_FILE } from "./paths.js";

export interface KillServiceOptions {
  /** Unix signal sent to the container's PID 1. Defaults to `"SIGKILL"`. */
  signal?: "SIGKILL" | "SIGTERM" | "SIGINT" | "SIGHUP";
}

/**
 * Send a signal to the container's PID 1 (`docker compose kill`).
 *
 * Default `SIGKILL` simulates an abrupt crash — the container stops
 * immediately without graceful shutdown. Use `SIGTERM` for a softer
 * teardown when the test wants the service to flush state.
 */
export async function killService(name: string, options: KillServiceOptions = {}): Promise<void> {
  const signal = options.signal ?? "SIGKILL";
  await run("docker", ["compose", "-f", COMPOSE_FILE, "kill", "-s", signal, name]);
}

/**
 * `docker compose start <service>` — resumes a stopped or killed
 * container. The image is reused (no rebuild), so the restart is
 * fast (~1 s for our services).
 */
export async function startService(name: string): Promise<void> {
  await run("docker", ["compose", "-f", COMPOSE_FILE, "start", name]);
}

/**
 * `docker compose pause <service>` — sends SIGSTOP via the container
 * runtime, freezing every process inside the container without
 * tearing the network or volumes down. Used by F2 to make
 * `boson-subgraph` lag the chain while a commit is in flight.
 *
 * Must be paired with {@link unpauseService} — a paused container
 * stays paused across test files. Wrap callers in `try/finally` so
 * a mid-test failure doesn't leave the suite's subgraph frozen.
 */
export async function pauseService(name: string): Promise<void> {
  await run("docker", ["compose", "-f", COMPOSE_FILE, "pause", name]);
}

/** `docker compose unpause <service>` — releases SIGSTOP. */
export async function unpauseService(name: string): Promise<void> {
  await run("docker", ["compose", "-f", COMPOSE_FILE, "unpause", name]);
}
