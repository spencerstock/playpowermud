/// <reference lib="webworker" />
import { MudConnection, type RelayStatus } from "./connection.js";
import { RELAY_IDLE_CLOSE_MS, type RelayWorkerIn, type RelayWorkerOut } from "./relayProtocol.js";

declare const self: SharedWorkerGlobalScope;

const clients = new Set<MessagePort>();
let session: MudConnection | null = null;
let sessionUrl = "";
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function broadcast(msg: RelayWorkerOut): void {
  for (const port of clients) {
    try {
      port.postMessage(msg);
    } catch {
      clients.delete(port);
    }
  }
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleClose(): void {
  clearIdleTimer();
  if (clients.size > 0 || !session) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (clients.size > 0 || !session) return;
    session.close("idle");
    session = null;
    sessionUrl = "";
  }, RELAY_IDLE_CLOSE_MS);
}

function wireSession(conn: MudConnection): void {
  conn.on("status", (status, reason) => broadcast({ type: "status", status, reason }));
  conn.on("data", (text) => broadcast({ type: "data", text }));
  conn.on("echo", (on) => broadcast({ type: "echo", on }));
  conn.on("sent", (line) => broadcast({ type: "sent", line }));
}

function ensureSession(url: string): MudConnection {
  if (session && sessionUrl === url) return session;
  session?.close("relay URL changed");
  sessionUrl = url;
  session = new MudConnection(url);
  wireSession(session);
  return session;
}

function syncStatus(port: MessagePort, status: RelayStatus, reason?: string): void {
  port.postMessage({ type: "status", status, reason } satisfies RelayWorkerOut);
}

function onMessage(port: MessagePort, raw: RelayWorkerIn): void {
  switch (raw.type) {
    case "attach":
      syncStatus(port, session?.status ?? "idle");
      return;
    case "detach":
      clients.delete(port);
      scheduleIdleClose();
      return;
    case "connect": {
      const conn = ensureSession(raw.url);
      if (conn.status === "closed" || conn.status === "idle") conn.connect();
      else syncStatus(port, conn.status);
      return;
    }
    case "close":
      session?.close(raw.reason ?? "closed by you");
      session = null;
      sessionUrl = "";
      clearIdleTimer();
      return;
    case "send":
      session?.sendLines(raw.lines);
      return;
    default:
      return;
  }
}

self.onconnect = (ev: MessageEvent): void => {
  const port = ev.ports[0];
  if (!port) return;
  clients.add(port);
  clearIdleTimer();
  port.start();
  port.onmessage = (e: MessageEvent<RelayWorkerIn>) => onMessage(port, e.data);
  syncStatus(port, session?.status ?? "idle");
};
