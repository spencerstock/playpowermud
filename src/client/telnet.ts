/**
 * Minimal telnet layer for the browser. The relay forwards raw MUD bytes; this strips IAC
 * negotiation and subnegotiation from the stream and reports server ECHO (Powermud sends
 * `IAC WILL ECHO` while it asks for a password). Like the old hub, it never answers
 * negotiation — Powermud does not need replies.
 */

export const IAC = 0xff;
const SE = 0xf0;
const SB = 0xfa;
const WILL = 0xfb;
const WONT = 0xfc;
const DO = 0xfd;
const DONT = 0xfe;
export const OPT_ECHO = 0x01;

type State = "data" | "iac" | "opt" | "sb" | "sb-iac";

export type TelnetChunk = {
  /** Payload bytes with every IAC sequence removed (`IAC IAC` → one 0xFF). */
  data: Uint8Array;
  /** Set when this chunk carried WILL/WONT ECHO: true = server echoes (hide local input). */
  serverEcho?: boolean;
};

export class TelnetFilter {
  private state: State = "data";
  private verb = 0;

  feed(bytes: Uint8Array): TelnetChunk {
    const out = new Uint8Array(bytes.length);
    let n = 0;
    let serverEcho: boolean | undefined;
    for (const b of bytes) {
      switch (this.state) {
        case "data":
          if (b === IAC) this.state = "iac";
          else out[n++] = b;
          break;
        case "iac":
          if (b === IAC) {
            out[n++] = IAC;
            this.state = "data";
          } else if (b === WILL || b === WONT || b === DO || b === DONT) {
            this.verb = b;
            this.state = "opt";
          } else if (b === SB) {
            this.state = "sb";
          } else {
            this.state = "data";
          }
          break;
        case "opt":
          if (b === OPT_ECHO && (this.verb === WILL || this.verb === WONT)) serverEcho = this.verb === WILL;
          this.state = "data";
          break;
        case "sb":
          if (b === IAC) this.state = "sb-iac";
          break;
        case "sb-iac":
          this.state = b === SE ? "data" : "sb";
          break;
      }
    }
    return serverEcho === undefined ? { data: out.subarray(0, n) } : { data: out.subarray(0, n), serverEcho };
  }

  reset(): void {
    this.state = "data";
    this.verb = 0;
  }
}

/** One wire line as UTF-8 bytes with CRLF (0xFF cannot occur in UTF-8, so no IAC escaping). */
export function encodeLine(line: string): Uint8Array {
  return new TextEncoder().encode(`${line}\r\n`);
}
