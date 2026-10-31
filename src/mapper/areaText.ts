/** Shared place-name cleanup for area inference and map display labels. */

/** Strip common ANSI SGR/CSI sequences (browser-safe). */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export const OVERWORLD_AREA = "overworld";

const BOILERPLATE_START =
  /^(?:you|this|the|upon|as|it|there|many|several|a|an|standing|entering|traveling)\b/i;
const GENERIC_PLACE =
  /^(?:city|town|village|area|region|tunnel|tunnels|cavern|cave|temple|building|island|passage|west|east|north|south)$/i;
const ALLOWED_SINGLE = new Set(["faerny", "granei", "dunkrist", "underdark"]);
const JUNK_WORDS = /\b(?:which|that|must|seems|their|than|higher|lead|looks|clear|home|dangerous|largest|known|almost|lies)\b/i;

export function cleanName(raw: string): string {
  let s = raw
    .replace(/\s+/g, " ")
    .replace(/'s$/i, "")
    .replace(/\s+(?:Merchant|Market)\s+Area.*$/i, "")
    .replace(/\s+has\b.*$/i, "")
    .replace(/\s+is\b.*$/i, "")
    .replace(/[,.]\s*$/, "")
    .trim();
  if (!s || BOILERPLATE_START.test(s) || JUNK_WORDS.test(s) || s.split(" ").length > 4) return "";
  if (s.split(" ").length === 1 && !ALLOWED_SINGLE.has(s.toLowerCase()) && GENERIC_PLACE.test(s)) return "";
  return s;
}

export function slugId(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || OVERWORLD_AREA;
}
