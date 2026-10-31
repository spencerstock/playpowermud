const MARKER_PREFIX = "@mudwithme/smart:";
const MARKER_SUFFIX = "@";
const LEGACY_CAD = "@mudwithme/smart-cad@";

export function smartAliasMarker(id: string): string {
  return `${MARKER_PREFIX}${id}${MARKER_SUFFIX}`;
}

/** Alias body in Link.cfg / aliases.local.json → smart alias id. */
export function parseSmartAliasMarker(body: string): string | null {
  if (body === LEGACY_CAD) return "cad";
  if (!body.startsWith(MARKER_PREFIX) || !body.endsWith(MARKER_SUFFIX)) return null;
  const id = body.slice(MARKER_PREFIX.length, -MARKER_SUFFIX.length).trim();
  return id || null;
}

/** User input like `cad` or `cad bishop` when `cad` is a registered smart trigger. */
export function parseSmartAliasLine(
  line: string,
  triggerNames: ReadonlySet<string> | readonly string[],
): { id: string; args: string | undefined } | null {
  const names = triggerNames instanceof Set ? triggerNames : new Set(triggerNames);
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes(";")) return null;
  const space = trimmed.search(/\s/);
  const stem = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  if (!names.has(stem)) return null;
  const args = space < 0 ? undefined : trimmed.slice(space + 1).trim();
  return { id: stem, args: args || undefined };
}
