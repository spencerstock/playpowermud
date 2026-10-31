/** Split Link-style alias bodies on `;`, respecting `{…}` nesting. */
export function splitZmudSegments(body: string): string[] {
  const segments: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) segments.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) segments.push(trimmed);
  return segments;
}

export type ZScriptExpandResult =
  | { ok: true; commands: string[]; variableUpdates: Record<string, string>; skipped: string[] }
  | { ok: false; reason: string };

/** Mudlet / Link client directives — no effect on the mudwithme TCP session. */
const MUDLET_ONLY =
  /^#(?:actiongroup|action|alias|unalias|hotkey|undelay|echo|load|variable|edit|bossmode|exit|time|print)\b/i;

/** Timing helpers — not scheduled in mudwithme yet; segments are skipped. */
const TIMING = /^#(?:delay|sleep)\b/i;

const SEND = /^#(?:raw)?send\b(?:\s+(.*))?$/is;

function parseSendPayload(payload: string | undefined): string[] {
  const text = (payload ?? "").trim();
  if (!text) return [];
  if (text.startsWith("{")) {
    let depth = 0;
    let end = -1;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]!;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return [text];
    const inner = text.slice(1, end).trim();
    if (!inner) return [];
    return splitZmudSegments(inner);
  }
  return [text];
}

function parseSet(segment: string): { name: string; value: string } | null {
  const m = /^#set\s+(\S+)\s+(.*)$/is.exec(segment.trim());
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), value: m[2]!.trim() };
}

/**
 * Expand a Link.cfg alias body that contains zScript (`#…`) into MUD command lines.
 * Supports `#send` / `#rawsend`, `#set`, plain segments, and skips Mudlet-only directives.
 */
export function expandZScriptBody(body: string): ZScriptExpandResult {
  const commands: string[] = [];
  const variableUpdates: Record<string, string> = {};
  const skipped: string[] = [];

  for (const segment of splitZmudSegments(body)) {
    const set = parseSet(segment);
    if (set) {
      variableUpdates[set.name] = set.value;
      continue;
    }

    const send = SEND.exec(segment);
    if (send) {
      commands.push(...parseSendPayload(send[1]));
      continue;
    }

    if (TIMING.test(segment) || MUDLET_ONLY.test(segment)) {
      skipped.push(segment);
      continue;
    }

    if (segment.startsWith("#")) {
      return {
        ok: false,
        reason: `Unsupported zScript in alias: ${segment.split(/\s+/)[0] ?? segment}`,
      };
    }

    commands.push(segment);
  }

  if (commands.length === 0) {
    const onlyClient = skipped.length > 0 && skipped.every((s) => MUDLET_ONLY.test(s));
    if (onlyClient) {
      return {
        ok: false,
        reason:
          "Alias only configures Mudlet (action groups, hotkeys, etc.) and has no commands for mudwithme.",
      };
    }
    return { ok: false, reason: "Alias expanded to no MUD commands." };
  }

  return { ok: true, commands, variableUpdates, skipped };
}
