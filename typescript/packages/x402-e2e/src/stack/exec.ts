// Thin promise-based wrapper around `child_process.spawn` for the
// `docker compose` invocations the stack helpers need. Streams stdout
// + stderr to the parent process so a long-running `docker compose up`
// or readiness loop surfaces progress in real time.

import { spawn } from "node:child_process";

export interface RunOptions {
  /** Working directory for the spawned process. */
  cwd?: string;
  /** When `true`, capture stdout instead of streaming it. */
  captureStdout?: boolean;
  /** Surface non-zero exit codes as rejected promises (default: true). */
  rejectOnNonZero?: boolean;
  /** Suppress stderr output (default: false; useful for polling probes). */
  silent?: boolean;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
}

export function run(
  command: string,
  args: readonly string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: [
        "ignore",
        opts.captureStdout ? "pipe" : "inherit",
        opts.silent ? "ignore" : "inherit",
      ],
    });

    let stdout = "";
    if (opts.captureStdout && child.stdout !== null) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }

    child.on("error", reject);
    child.on("close", (exitCode) => {
      const code = exitCode ?? -1;
      const result: RunResult = { exitCode: code, stdout };
      if (code !== 0 && opts.rejectOnNonZero !== false) {
        reject(
          new Error(
            `command failed (exit ${code}): ${command} ${args.join(" ")}${stdout ? `\n${stdout}` : ""}`,
          ),
        );
        return;
      }
      resolveRun(result);
    });
  });
}
