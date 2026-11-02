import { MudConnection, type ConnectionEvents, type RelayStatus } from "./connection.js";
import { RELAY_SHARED_WORKER_URL, type RelayWorkerIn, type RelayWorkerOut } from "./relayProtocol.js";

/**
 * Browser-side proxy to the shared relay worker. Keeps one WebSocket (and MUD TCP session) while
 * you move between the game page and the wiki in the same tab.
 */
export class RelayClient {
  private readonly port: MessagePort;
  private listeners: {
    [K in keyof ConnectionEvents]: Set<ConnectionEvents[K]>;
  } = { status: new Set(), data: new Set(), echo: new Set(), sent: new Set() };
  private _status: RelayStatus = "idle";

  constructor(private readonly url: string) {
    const worker = new SharedWorker(RELAY_SHARED_WORKER_URL, {
      type: "module",
      name: "playpowermud-relay",
    });
    this.port = worker.port;
    this.port.start();
    this.port.onmessage = (ev: MessageEvent<RelayWorkerOut>) => this.onWorkerMessage(ev.data);
    this.port.postMessage({ type: "attach" } satisfies RelayWorkerIn);
    window.addEventListener("pagehide", this.onPageHide);
  }

  private onPageHide = (): void => {
    this.port.postMessage({ type: "detach" } satisfies RelayWorkerIn);
    window.removeEventListener("pagehide", this.onPageHide);
  };

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

  private onWorkerMessage(msg: RelayWorkerOut): void {
    switch (msg.type) {
      case "status":
        this.setStatus(msg.status, msg.reason);
        break;
      case "data":
        this.emit("data", msg.text);
        break;
      case "echo":
        this.emit("echo", msg.on);
        break;
      case "sent":
        this.emit("sent", msg.line);
        break;
      default:
        break;
    }
  }

  connect(): void {
    this.port.postMessage({ type: "connect", url: this.url } satisfies RelayWorkerIn);
  }

  sendLine(line: string): void {
    this.sendLines([line]);
  }

  sendLines(lines: string[]): void {
    if (!this.connected) throw new Error("Not connected");
    this.port.postMessage({ type: "send", lines } satisfies RelayWorkerIn);
  }

  close(reason = "closed by you"): void {
    this.port.postMessage({ type: "close", reason } satisfies RelayWorkerIn);
    this.setStatus("closed", reason);
  }
}

/** Open a passive attach so wiki pages keep the shared relay alive while you read. */
export function attachWikiRelayKeepalive(): void {
  if (typeof SharedWorker === "undefined") return;
  const worker = new SharedWorker(RELAY_SHARED_WORKER_URL, {
    type: "module",
    name: "playpowermud-relay",
  });
  const port = worker.port;
  port.start();
  port.postMessage({ type: "attach" } satisfies RelayWorkerIn);
  window.addEventListener("pagehide", () => {
    port.postMessage({ type: "detach" } satisfies RelayWorkerIn);
  });
}

export type MudConnectionHandle = MudConnection | RelayClient;

export function createMudConnection(url: string): MudConnectionHandle {
  if (typeof SharedWorker === "undefined") return new MudConnection(url);
  try {
    return new RelayClient(url);
  } catch {
    return new MudConnection(url);
  }
}
