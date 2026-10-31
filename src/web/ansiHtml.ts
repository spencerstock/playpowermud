export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export type AnsiSkin = "dark" | "light";

let currentAnsiSkin: AnsiSkin = "dark";

export function setAnsiSkin(skin: AnsiSkin): void {
  currentAnsiSkin = skin;
}

export function getAnsiSkin(): AnsiSkin {
  return currentAnsiSkin;
}

/** Link.cfg / Mudlet / xterm palette → readable on light background. */
const LIGHT_FG_BY_HEX: Record<string, string> = {
  "#000000": "#2e3436",
  "#555753": "#2e3436",
  "#888a85": "#3d4446",
  "#cc0000": "#a40000",
  "#ef2929": "#a40000",
  "#ff6e67": "#b80000",
  "#4e9a06": "#2d6a00",
  "#8ae234": "#2d6a00",
  "#b8ff9a": "#1d5700",
  "#c4a000": "#806000",
  "#fce94f": "#806000",
  "#ffffa5": "#806000",
  "#3465a4": "#204a87",
  "#729fcf": "#204a87",
  "#a5caff": "#1a3d73",
  "#75507b": "#6c004f",
  "#ad7fa8": "#6c004f",
  "#e898ff": "#5a0066",
  "#06989a": "#00656b",
  "#34e2e2": "#00656b",
  "#8fffff": "#005a60",
  "#d3d7cf": "#4e5664",
  "#eeeeec": "#4e5664",
  "#ffffff": "#4e5664",
  "#d6dde6": "#1a1f2e",
};

const LIGHT_BG_BY_HEX: Record<string, string> = {
  "#000000": "#e8eaef",
  "#555753": "#dfe3ea",
  "#cc0000": "#ffd6d6",
  "#ef2929": "#ffd6d6",
  "#4e9a06": "#dceec8",
  "#8ae234": "#dceec8",
  "#c4a000": "#f5e6a8",
  "#fce94f": "#f5e6a8",
  "#3465a4": "#d4e4f7",
  "#729fcf": "#d4e4f7",
  "#75507b": "#ecd9ef",
  "#ad7fa8": "#ecd9ef",
  "#06989a": "#c8eef0",
  "#34e2e2": "#c8eef0",
  "#d3d7cf": "#eef0f3",
  "#eeeeec": "#eef0f3",
  "#ffffff": "#eef0f3",
};

function parseCssColor(css: string): { r: number; g: number; b: number } | null {
  const s = css.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1]!;
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 8) h = h.slice(2);
    if (h.length !== 6) return null;
    const n = Number.parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const n = ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  return `#${n.toString(16).padStart(6, "0")}`;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function darkenRgb(r: number, g: number, b: number, factor: number): string {
  return rgbToHex(
    Math.round(r * factor),
    Math.round(g * factor),
    Math.round(b * factor),
  );
}

function lightenRgb(r: number, g: number, b: number, mix: number): string {
  return rgbToHex(
    Math.round(r + (255 - r) * mix),
    Math.round(g + (255 - g) * mix),
    Math.round(b + (255 - b) * mix),
  );
}

/** Remap truecolor / 256-color CSS for the active UI skin. */
export function recastInlineColor(css: string, role: "fg" | "bg"): string {
  if (currentAnsiSkin === "dark") return css;
  const rgb = parseCssColor(css);
  if (!rgb) return css;
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  const mapped = (role === "fg" ? LIGHT_FG_BY_HEX : LIGHT_BG_BY_HEX)[hex];
  if (mapped) return mapped;

  const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);
  if (role === "fg") {
    if (lum > 0.62) return darkenRgb(rgb.r, rgb.g, rgb.b, 0.42);
    if (lum > 0.45) return darkenRgb(rgb.r, rgb.g, rgb.b, 0.72);
    return css;
  }
  if (lum < 0.12) return lightenRgb(rgb.r, rgb.g, rgb.b, 0.88);
  if (lum > 0.75) return darkenRgb(rgb.r, rgb.g, rgb.b, 0.82);
  return css;
}

const FG: Record<number, string> = {
  30: "ansi-fg-black",
  31: "ansi-fg-red",
  32: "ansi-fg-green",
  33: "ansi-fg-yellow",
  34: "ansi-fg-blue",
  35: "ansi-fg-magenta",
  36: "ansi-fg-cyan",
  37: "ansi-fg-white",
  90: "ansi-fg-bright-black",
  91: "ansi-fg-bright-red",
  92: "ansi-fg-bright-green",
  93: "ansi-fg-bright-yellow",
  94: "ansi-fg-bright-blue",
  95: "ansi-fg-bright-magenta",
  96: "ansi-fg-bright-cyan",
  97: "ansi-fg-bright-white",
};

const BG: Record<number, string> = {
  40: "ansi-bg-black",
  41: "ansi-bg-red",
  42: "ansi-bg-green",
  43: "ansi-bg-yellow",
  44: "ansi-bg-blue",
  45: "ansi-bg-magenta",
  46: "ansi-bg-cyan",
  47: "ansi-bg-white",
  100: "ansi-bg-bright-black",
  101: "ansi-bg-bright-red",
  102: "ansi-bg-bright-green",
  103: "ansi-bg-bright-yellow",
  104: "ansi-bg-bright-blue",
  105: "ansi-bg-bright-magenta",
  106: "ansi-bg-bright-cyan",
  107: "ansi-bg-bright-white",
};

type StyleState = {
  classes: Set<string>;
  color?: string;
  backgroundColor?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

function defaultStyle(): StyleState {
  return {
    classes: new Set(),
    bold: false,
    italic: false,
    underline: false,
  };
}

function resetStyle(s: StyleState): void {
  s.classes.clear();
  s.color = undefined;
  s.backgroundColor = undefined;
  s.bold = false;
  s.italic = false;
  s.underline = false;
}

/** xterm 256-color palette → CSS rgb. */
export function ansi256ToRgb(n: number): string {
  if (n < 0) n = 0;
  if (n > 255) n = 255;
  if (n < 16) {
    const map = [
      "#000000",
      "#cc0000",
      "#4e9a06",
      "#c4a000",
      "#3465a4",
      "#75507b",
      "#06989a",
      "#d3d7cf",
      "#555753",
      "#ef2929",
      "#8ae234",
      "#fce94f",
      "#729fcf",
      "#ad7fa8",
      "#34e2e2",
      "#eeeeec",
    ];
    return map[n] ?? "#d6dde6";
  }
  if (n < 232) {
    const i = n - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const step = [0, 95, 135, 175, 215, 255];
    return `rgb(${step[r]}, ${step[g]}, ${step[b]})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

function applySgrParam(style: StyleState, code: number, params: number[], idx: number): number {
  if (code === 0) {
    resetStyle(style);
    return idx;
  }
  if (code === 1) {
    style.bold = true;
    return idx;
  }
  if (code === 3) {
    style.italic = true;
    return idx;
  }
  if (code === 4) {
    style.underline = true;
    return idx;
  }
  if (code === 22) {
    style.bold = false;
    return idx;
  }
  if (code === 23) {
    style.italic = false;
    return idx;
  }
  if (code === 24) {
    style.underline = false;
    return idx;
  }
  if (code === 39) {
    for (const c of [...style.classes]) {
      if (c.startsWith("ansi-fg-")) style.classes.delete(c);
    }
    style.color = undefined;
    return idx;
  }
  if (code === 49) {
    for (const c of [...style.classes]) {
      if (c.startsWith("ansi-bg-")) style.classes.delete(c);
    }
    style.backgroundColor = undefined;
    return idx;
  }
  if (FG[code]) {
    for (const c of [...style.classes]) {
      if (c.startsWith("ansi-fg-")) style.classes.delete(c);
    }
    style.color = undefined;
    style.classes.add(FG[code]!);
    return idx;
  }
  if (BG[code]) {
    for (const c of [...style.classes]) {
      if (c.startsWith("ansi-bg-")) style.classes.delete(c);
    }
    style.backgroundColor = undefined;
    style.classes.add(BG[code]!);
    return idx;
  }
  if (code === 38 && params[idx] === 5 && params[idx + 1] !== undefined) {
    for (const c of [...style.classes]) {
      if (c.startsWith("ansi-fg-")) style.classes.delete(c);
    }
    style.classes.delete("ansi-fg-default");
    style.color = ansi256ToRgb(params[idx + 1]!);
    return idx + 2;
  }
  if (
    code === 38 &&
    params[idx] === 2 &&
    params[idx + 1] !== undefined &&
    params[idx + 2] !== undefined &&
    params[idx + 3] !== undefined
  ) {
    for (const c of [...style.classes]) {
      if (c.startsWith("ansi-fg-")) style.classes.delete(c);
    }
    style.color = `rgb(${params[idx + 1]}, ${params[idx + 2]}, ${params[idx + 3]})`;
    return idx + 4;
  }
  if (code === 48 && params[idx] === 5 && params[idx + 1] !== undefined) {
    for (const c of [...style.classes]) {
      if (c.startsWith("ansi-bg-")) style.classes.delete(c);
    }
    style.backgroundColor = ansi256ToRgb(params[idx + 1]!);
    return idx + 2;
  }
  if (
    code === 48 &&
    params[idx] === 2 &&
    params[idx + 1] !== undefined &&
    params[idx + 2] !== undefined &&
    params[idx + 3] !== undefined
  ) {
    style.backgroundColor = `rgb(${params[idx + 1]}, ${params[idx + 2]}, ${params[idx + 3]})`;
    return idx + 4;
  }
  return idx;
}

function applySgr(style: StyleState, params: number[]): void {
  if (params.length === 0) params = [0];
  let i = 0;
  while (i < params.length) {
    const code = params[i]!;
    if (code === 38 || code === 48) {
      i = applySgrParam(style, code, params, i + 1);
      continue;
    }
    i = applySgrParam(style, code, params, i) + 1;
  }
}

function openSpan(style: StyleState): string {
  const classes = [...style.classes];
  if (style.bold) classes.push("ansi-bold");
  if (style.italic) classes.push("ansi-italic");
  if (style.underline) classes.push("ansi-underline");
  const parts: string[] = [];
  if (classes.length) parts.push(`class="${classes.join(" ")}"`);
  const css: string[] = [];
  if (style.color) {
    parts.push(`data-ansi-fg="${escapeAttr(style.color)}"`);
    css.push(`color:${recastInlineColor(style.color, "fg")}`);
  }
  if (style.backgroundColor) {
    parts.push(`data-ansi-bg="${escapeAttr(style.backgroundColor)}"`);
    css.push(`background-color:${recastInlineColor(style.backgroundColor, "bg")}`);
  }
  if (css.length) parts.push(`style="${css.join(";")}"`);
  if (parts.length === 0) return "";
  return `<span ${parts.join(" ")}>`;
}

/** Convert MUD ANSI/VT100 SGR output to safe HTML for the Web UI log. */
export function ansiToHtml(text: string): string {
  const style = defaultStyle();
  let out = "";
  let run = "";
  let open = openSpan(style);

  const flush = () => {
    if (run === "") return;
    out += open + escapeHtml(run) + (open ? "</span>" : "");
    run = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\x1b" && text[i + 1] === "[") {
      let j = i + 2;
      while (j < text.length && text[j]! >= "\x30" && text[j]! <= "\x3f") j++;
      while (j < text.length && text[j]! >= "\x20" && text[j]! <= "\x2f") j++;
      if (j < text.length) {
        const cmd = text[j]!;
        if (cmd === "m") {
          flush();
          const body = text.slice(i + 2, j);
          const params = body === "" ? [0] : body.split(";").map((p) => Number.parseInt(p, 10));
          applySgr(style, params.map((n) => (Number.isNaN(n) ? 0 : n)));
          open = openSpan(style);
          i = j;
          continue;
        }
        i = j;
        continue;
      }
    }
    if (ch === "\r") continue;
    run += ch;
  }
  flush();
  return out;
}
