import { encodeLine, TelnetFilter } from "./telnet.js";

/**
 * Browser side of the relay: one WebSocket = one MUD TCP session. Binary frames carry raw MUD
 * bytes both ways; text frames are relay status JSON (`{ type: "status", state, reason? }`).
 */

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

/** `RELAY_URL` baked in at build time, else this site's own `/api/ws`. `?relay=` overrides for testing. */
export function defaultRelayUrl(loc: Location, built: string): string {
  const fromQuery = new URLSearchParams(loc.search).get("relay")?.trim();
  if (fromQuery) return fromQuery;
  if (built) return built;
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/api/ws`;
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
    ws.addEventListener("message", (ev) => {
      if (this.ws !== ws) return;
      if (typeof ev.data === "string") {
        this.onControl(ev.data);
        return;
      }
      const chunk = this.telnet.feed(new Uint8Array(ev.data as ArrayBuffer));
      if (chunk.serverEcho !== undefined) this.emit("echo", chunk.serverEcho);
      const text = this.decoder.decode(chunk.data, { stream: true });
      if (text) this.emit("data", text);
    });
    ws.addEventListener("close", (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus("closed", ev.reason || (ev.code === 1006 ? "relay connection lost" : undefined));
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
