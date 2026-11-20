import { encodeLine, TelnetFilter } from "./telnet.js";

/**
 * Browser side of the MUD socket: one WebSocket = one session. Binary frames carry raw MUD
 * bytes both ways. Our legacy TCP relay (`/api/ws`) also sends text frames of status JSON
 * (`{ type: "status", state, reason? }`). Powermud's own WebSocket does not.
 */

/** Production Powermud. Port 2000 is prod; port 2001 is their dev instance. */
export const PRODUCTION_MUD_WS_URL = "wss://powermud.com:2000";

export type RelayStatus = "idle" | "connecting" | "connected" | "closed";

export type ConnectionEvents = {
  status: (status: RelayStatus, reason?: string) => void;
  /** Decoded MUD text (telnet stripped, UTF-8 streamed across frames). */
  data: (text: string) => void;
  /** Server took over echo (password prompt) or gave it back. */
  echo: (serverEchoes: boolean) => void;
  /** A line actually written to the MUD (mapper + prompt accounting). */
  sent: (line: string) => void;
};

type Listeners = { [K in keyof ConnectionEvents]: Set<ConnectionEvents[K]> };

/**
 * WebSocket the browser opens.
 * `?relay=` overrides (debug, self-hosted pipe, alt host).
 * `built` is compile-time `MUD_WS_URL` (`RELAY_URL` is the old name).
 * An empty build value means {@link PRODUCTION_MUD_WS_URL}, not this site's `/api/ws`.
 */
export function defaultMudWebSocketUrl(loc: Pick<Location, "search">, built: string): string {
  const fromQuery = new URLSearchParams(loc.search).get("relay")?.trim();
  if (fromQuery) return fromQuery;
  const baked = built.trim();
  if (baked) return baked;
  return PRODUCTION_MUD_WS_URL;
}

/** Same as {@link defaultMudWebSocketUrl}. Kept so older call sites keep compiling. */
export const defaultRelayUrl = defaultMudWebSocketUrl;

/** True when `url` is our TCP relay (`/api/ws`), which speaks status JSON on text frames. */
export function isRelayWebSocket(url: string): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
    return path === "/api/ws" || path.startsWith("/api/ws/");
  } catch {
    return false;
  }
}

/**
 * Powermud's native socket (prod `:2000`, dev `:2001`, or `/ws2000` / `/ws2001` on 443)
 * speaks telnet bytes only. Anything that is not our `/api/ws` relay is treated as direct.
 * The first binary frame still promotes `connecting` → `connected` if this guess is wrong.
 */
export function isDirectMudWebSocket(url: string): boolean {
  try {
    new URL(url);
  } catch {
    return false;
  }
  return !isRelayWebSocket(url);
}

export class MudConnection {
  private ws: WebSocket | null = null;
  private telnet = new TelnetFilter();
  private decoder = new TextDecoder("utf-8");
  private listeners: Listeners = { status: new Set(), data: new Set(), echo: new Set(), sent: new Set() };
  private _status: RelayStatus = "idle";

  constructor(private readonly url: string) {}

  get status(): RelayStatus {
    return this._status;
  }

  get connected(): boolean {
    return this._status === "connected";
  }

  on<K extends keyof ConnectionEvents>(event: K, fn: ConnectionEvents[K]): () => void {
    (this.listeners[event] as Set<ConnectionEvents[K]>).add(fn);
    return () => (this.listeners[event] as Set<ConnectionEvents[K]>).delete(fn);
  }

  private emit<K extends keyof ConnectionEvents>(event: K, ...args: Parameters<ConnectionEvents[K]>): void {
    for (const fn of this.listeners[event] as Set<(...a: Parameters<ConnectionEvents[K]>) => void>) fn(...args);
  }

  private setStatus(status: RelayStatus, reason?: string): void {
    if (this._status === status && !reason) return;
    this._status = status;
    this.emit("status", status, reason);
  }

  connect(): void {
    this.close();
    this.telnet.reset();
    this.decoder = new TextDecoder("utf-8");
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      if (isDirectMudWebSocket(this.url)) this.setStatus("connected");
    });
    ws.addEventListener("message", (ev) => {
      if (this.ws !== ws) return;
      if (typeof ev.data === "string") {
        this.onControl(ev.data);
        return;
      }
      if (this._status === "connecting") this.setStatus("connected");
      const chunk = this.telnet.feed(new Uint8Array(ev.data as ArrayBuffer));
      if (chunk.serverEcho !== undefined) this.emit("echo", chunk.serverEcho);
      const text = this.decoder.decode(chunk.data, { stream: true });
      if (text) this.emit("data", text);
    });
    ws.addEventListener("close", (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      const lost = isDirectMudWebSocket(this.url) ? "connection lost" : "relay connection lost";
      this.setStatus("closed", ev.reason || (ev.code === 1006 ? lost : undefined));
    });
    ws.addEventListener("error", () => {
      // `close` follows with the details.
    });
  }

  private onControl(raw: string): void {
    let msg: { type?: string; state?: string; reason?: string };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (msg.type !== "status") return;
    if (msg.state === "connected") this.setStatus("connected");
    else if (msg.state === "closed") this.setStatus("closed", msg.reason);
  }

  /** Every line written is announced as `sent`. */
  sendLine(line: string): void {
    this.sendLines([line]);
  }

  /** `;` chains go out back-to-back in one frame. */
  sendLines(lines: string[]): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this._status !== "connected") throw new Error("Not connected");
    if (lines.length === 0) return;
    const parts = lines.map(encodeLine);
    const payload = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      payload.set(p, off);
      off += p.length;
    }
    ws.send(payload);
    for (const line of lines) this.emit("sent", line);
  }

  close(reason = "closed by you"): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    try {
      ws.close(1000, reason);
    } catch {
      /* already closing */
    }
    this.setStatus("closed", reason);
  }
}
