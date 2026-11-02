import type { RelayStatus } from "./connection.js";

/** Messages from a browser document to the shared relay worker. */
export type RelayWorkerIn =
  | { type: "attach" }
  | { type: "detach" }
  | { type: "connect"; url: string }
  | { type: "close"; reason?: string }
  | { type: "send"; lines: string[] };

/** Messages from the shared relay worker to a browser document. */
export type RelayWorkerOut =
  | { type: "status"; status: RelayStatus; reason?: string }
  | { type: "data"; text: string }
  | { type: "echo"; on: boolean }
  | { type: "sent"; line: string };

/** Grace period after the last tab detaches before the MUD socket is closed. */
export const RELAY_IDLE_CLOSE_MS = 30_000;

export const RELAY_SHARED_WORKER_URL = "/build/relay.shared.js";
