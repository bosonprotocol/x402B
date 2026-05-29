// Minimal four-method logger interface threaded through the server.
// Matches the de-facto shape every observability library in the JS
// ecosystem (pino, winston, console, bunyan, …) so hosts adapt their
// existing logger in one line. The default is `noopLogger`, which
// discards every event — no overhead, no surprise output, opt-in
// observability.

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** No-op logger — the default when the host doesn't supply one. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
