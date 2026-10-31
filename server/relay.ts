import type { IncomingMessage, Server } from "node:http";
import net from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * WebSocket ↔ telnet relay. Each WebSocket gets its own TCP connection to the MUD; binary
 * frames are raw bytes both ways, text frames are status JSON. The target is fixed by the
 * server (MUD_HOST / MUD_PORT) — clients can never choose where the relay connects.
 */

export type RelayOptions = {
  host: string;
  port: number;
  /** Allowed `Origin` headers; empty = allow any (the relay only ever reaches the MUD). */
  allowedOrigins: string[];
  log?: (line: string) => void;
};

export function relayOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): RelayOptions {
  return {
    host: env.MUD_HOST?.trim() || "powermud.com",
    port: Number(env.MUD_PORT) || 2000,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    log: (line) => console.log(`[relay] ${line}`),
  };
}

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  return !!origin && allowed.includes(origin);
}

function status(ws: WebSocket, state: "connected" | "closed", reason?: string): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(reason ? { type: "status", state, reason } : { type: "status", state }));
}

/** Pipe one accepted WebSocket to a fresh MUD socket until either side closes. */
export function relayConnection(ws: WebSocket, opts: RelayOptions): void {
  const tcp = net.createConnection({ host: opts.host, port: opts.port });
  tcp.setNoDelay(true);
  tcp.setKeepAlive(true, 30_000);
  let closed = false;
  const pending: Buffer[] = [];

  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    opts.log?.(`session closed: ${reason}`);
    status(ws, "closed", reason);
    tcp.destroy();
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(1000, reason.slice(0, 120));
  };

  tcp.on("connect", () => {
    opts.log?.(`connected to ${opts.host}:${opts.port}`);
    status(ws, "connected");
    for (const b of pending.splice(0)) tcp.write(b);
  });
  tcp.on("data", (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
  });
  tcp.on("error", (err) => finish(`MUD connection error: ${err.message}`));
  tcp.on("close", () => finish("MUD closed the connection"));

  ws.on("message", (data, isBinary) => {
    if (!isBinary) return;
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    if (tcp.connecting) pending.push(buf);
    else if (!tcp.destroyed) tcp.write(buf);
  });
  ws.on("close", () => finish("browser disconnected"));
  ws.on("error", (err) => finish(`browser socket error: ${err.message}`));
}

/** Attach the relay to an HTTP server at `path` (default `/api/ws`). */
export function attachRelay(server: Server, opts: RelayOptions, path = "/api/ws"): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }
    if (!originAllowed(req.headers.origin, opts.allowedOrigins)) {
      opts.log?.(`rejected origin ${req.headers.origin ?? "(none)"}`);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => relayConnection(ws, opts));
  });
  return wss;
}
