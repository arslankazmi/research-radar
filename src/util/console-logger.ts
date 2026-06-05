import type { Logger } from "../contracts.js";

/** Default logger for the CLI / tests. The plugin entry injects OpenClaw's logger instead. */
export const consoleLogger: Logger = {
  info: (msg, ...args) => console.error(`[radar] ${msg}`, ...args),
  warn: (msg, ...args) => console.error(`[radar:warn] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[radar:error] ${msg}`, ...args),
};
