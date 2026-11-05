/** Parsed keyboard chord for matching `KeyboardEvent.code`. */
export type KeyBinding = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  code: string;
};

const FN = /^F(?:[1-9]|1[0-2])$/i;
const MOD = new Set(["ctrl", "control", "alt", "shift", "meta", "cmd", "command", "win"]);

/** Built-in client shortcuts (wiki panel toggles). */
export function isReservedBinding(binding: KeyBinding): boolean {
  return binding.alt && !binding.ctrl && !binding.shift && !binding.meta && ["KeyW", "KeyM", "KeyC", "KeyD"].includes(binding.code);
}

export function formatKeyBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  if (binding.meta) parts.push("Meta");
  if (FN.test(binding.code)) parts.push(binding.code.toUpperCase());
  else if (binding.code.startsWith("Key")) parts.push(binding.code.slice(3));
  else if (binding.code.startsWith("Digit")) parts.push(binding.code.slice(5));
  else parts.push(binding.code);
  return parts.join("+");
}

export function parseKeyBinding(spec: string): { ok: true; binding: KeyBinding } | { ok: false; reason: string } {
  const trimmed = spec.trim();
  if (!trimmed) return { ok: false, reason: "missing key" };

  const parts = trimmed.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { ok: false, reason: "missing key" };

  const binding: KeyBinding = { ctrl: false, alt: false, shift: false, meta: false, code: "" };
  let keyPart: string | null = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MOD.has(lower)) {
      if (lower === "ctrl" || lower === "control") binding.ctrl = true;
      else if (lower === "alt") binding.alt = true;
      else if (lower === "shift") binding.shift = true;
      else binding.meta = true;
      continue;
    }
    if (keyPart !== null) return { ok: false, reason: `invalid key chord: ${spec}` };
    keyPart = part;
  }

  if (!keyPart) return { ok: false, reason: "missing key" };
  const code = keyTokenToCode(keyPart);
  if (!code) return { ok: false, reason: `unknown key: ${keyPart}` };
  binding.code = code;

  if (!isAllowedUserBinding(binding)) {
    return {
      ok: false,
      reason: "use F1–F12 or a chord with Ctrl, Alt, Shift, or Meta (plain letters conflict with typing)",
    };
  }
  if (isReservedBinding(binding)) {
    return { ok: false, reason: "that key is reserved for a built-in client shortcut" };
  }
  return { ok: true, binding };
}

export function normalizeKeySpec(spec: string): { ok: true; key: string } | { ok: false; reason: string } {
  const parsed = parseKeyBinding(spec);
  if (!parsed.ok) return parsed;
  return { ok: true, key: formatKeyBinding(parsed.binding) };
}

export function eventMatchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  return (
    e.ctrlKey === binding.ctrl &&
    e.altKey === binding.alt &&
    e.shiftKey === binding.shift &&
    e.metaKey === binding.meta &&
    e.code === binding.code
  );
}

export function bindingFromStoredKey(key: string): KeyBinding | null {
  const parsed = parseKeyBinding(key);
  return parsed.ok ? parsed.binding : null;
}

function isAllowedUserBinding(binding: KeyBinding): boolean {
  if (FN.test(binding.code)) return true;
  return binding.ctrl || binding.alt || binding.shift || binding.meta;
}

function keyTokenToCode(token: string): string | null {
  if (FN.test(token)) return token.toUpperCase();
  if (/^[a-z]$/i.test(token)) return `Key${token.toUpperCase()}`;
  if (/^\d$/.test(token)) return `Digit${token}`;
  if (/^Key[A-Z]$/.test(token)) return token;
  if (/^Digit[0-9]$/.test(token)) return token;
  if (/^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Enter|Space|Tab|Backspace|Delete|Home|End|PageUp|PageDown)$/.test(token)) {
    return token;
  }
  return null;
}
