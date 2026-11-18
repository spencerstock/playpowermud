import { parseDelayCommand, splitDelayTokens } from "../scripting/actionDelay.js";
import { parseSmartAliasMarker } from "../smartAliases/markers.js";
import { expandZScriptBody } from "./zscript.js";

export type AliasEngineOptions = {
  commandSeparator: string;
  variables: Record<string, string>;
};

function splitCommands(text: string, sep: string): string[] {
  if (sep === ";") {
    return text
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return text
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

function expandVariables(
  text: string,
  variables: Record<string, string>,
  positional: Record<string, string> = {},
): string {
  let out = text.replace(/\$(\w+)\$/g, (_, name: string) => {
    if (Object.hasOwn(positional, name)) return positional[name] ?? "";
    return variables[name] ?? "";
  });
  // `@delay` is a pause (`@delay 2`), not a variable named delay. `$delay$` still expands.
  out = out.replace(/@(\w+)/g, (full: string, name: string) => {
    if (/^delay$/i.test(name)) return full;
    return variables[name] ?? "";
  });
  return out;
}

function withTrailingArg(parts: string[], arg: string): string[] {
  return parts.map((cmd) => (parseDelayCommand(cmd) ? cmd : cmd ? `${cmd} ${arg}` : arg));
}

/** `ca $1$` bodies use `$1$` for the arg; exact stems also accept suffix args (`bs orc` → `backstab orc`). */
const PREFIX_ALIAS_NAME = /^(\S+)\s+\$1\$$/;
const MAX_ALIAS_EXPAND_DEPTH = 16;

export type AliasResolveResult = {
  kind: "alias" | "command" | "blocked" | "smart_alias" | "sequence";
  commands: string[];
  smartAliasId?: string;
  smartAliasArgs?: string;
  note?: string;
  /** zScript segments skipped (Mudlet-only or timing). */
  zscriptSkipped?: string[];
  /** Chained input (`w;cnf`): each segment resolved on its own. */
  segments?: AliasResolveResult[];
};

export class AliasEngine {
  private exact = new Map<string, string>();
  private prefix = new Map<string, string>();
  private zscript = new Map<string, string>();
  private options: AliasEngineOptions;

  constructor(options: AliasEngineOptions) {
    this.options = options;
  }

  loadAliases(aliases: Map<string, string>): { plain: number; zscript: number } {
    this.exact.clear();
    this.prefix.clear();
    this.zscript.clear();
    let plain = 0;
    let zscript = 0;
    for (const [name, body] of aliases.entries()) {
      if (body.includes("#")) {
        this.zscript.set(name.toLowerCase(), body);
        zscript += 1;
        continue;
      }
      const prefixStem = PREFIX_ALIAS_NAME.exec(name.trim())?.[1];
      if (prefixStem) {
        this.prefix.set(prefixStem.toLowerCase(), body);
        plain += 1;
        continue;
      }
      this.exact.set(name.toLowerCase(), body);
      plain += 1;
    }
    return { plain, zscript };
  }

  setVariable(name: string, value: string): void {
    this.options.variables[name] = value;
  }

  reconfigure(partial: Partial<AliasEngineOptions>): void {
    if (partial.commandSeparator !== undefined) {
      this.options.commandSeparator = partial.commandSeparator;
    }
    if (partial.variables !== undefined) {
      this.options.variables = partial.variables;
    }
  }

  /** Alias body → command parts, with `@delay N` kept as its own part. */
  private bodyParts(
    body: string,
    positional?: Record<string, string>,
  ): { ok: true; parts: string[] } | { ok: false; reason: string } {
    const expanded = expandVariables(body, this.options.variables, positional);
    const parts: string[] = [];
    for (const part of splitCommands(expanded, this.options.commandSeparator)) {
      const bits = splitDelayTokens(part);
      if (!bits.ok) return bits;
      parts.push(...bits.parts);
    }
    return { ok: true, parts };
  }

  /** Expand alias bodies that reference other aliases (`dcore` → `cmi` → cast …). */
  private flattenAliasParts(parts: string[], depth = 0): AliasResolveResult {
    if (depth > MAX_ALIAS_EXPAND_DEPTH) {
      return {
        kind: "blocked",
        commands: [],
        note: "Alias expansion depth exceeded (cycle?)",
      };
    }
    const commands: string[] = [];
    const zscriptSkipped: string[] = [];
    for (const part of parts) {
      const r = this.resolveSegment(part, depth);
      if (r.kind === "blocked" || r.kind === "smart_alias") return r;
      if (r.kind === "alias") {
        const inner = this.flattenAliasParts(r.commands, depth + 1);
        if (inner.kind === "blocked" || inner.kind === "smart_alias") return inner;
        commands.push(...inner.commands);
        zscriptSkipped.push(...(inner.zscriptSkipped ?? []));
        continue;
      }
      commands.push(...r.commands);
      zscriptSkipped.push(...(r.zscriptSkipped ?? []));
    }
    return {
      kind: "alias",
      commands,
      zscriptSkipped: zscriptSkipped.length > 0 ? zscriptSkipped : undefined,
    };
  }

  /**
   * One user segment after `;` splitting (or the whole line when unsplit). `depth` counts
   * alias bodies already expanded, so `a → b → a` stops at the guard instead of recursing forever.
   */
  private resolveSegment(trimmed: string, depth = 0): AliasResolveResult {
    if (parseDelayCommand(trimmed)) {
      return { kind: "command", commands: [trimmed.trim()] };
    }
    const key = trimmed.toLowerCase();
    const z = this.zscript.get(key);
    if (z) {
      const expanded = expandZScriptBody(z);
      if (!expanded.ok) {
        return {
          kind: "blocked",
          commands: [],
          note: `Alias "${trimmed}": ${expanded.reason}`,
        };
      }
      for (const [name, value] of Object.entries(expanded.variableUpdates)) {
        this.options.variables[name] = value;
      }
      const withVars: string[] = [];
      for (const cmd of expanded.commands) {
        const bits = splitDelayTokens(expandVariables(cmd, this.options.variables));
        if (!bits.ok) {
          return {
            kind: "blocked",
            commands: [],
            note: `Alias "${trimmed}": ${bits.reason}`,
          };
        }
        withVars.push(...bits.parts);
      }
      return {
        kind: "alias",
        commands: withVars,
        zscriptSkipped: expanded.skipped.length > 0 ? expanded.skipped : undefined,
      };
    }

    const body = this.exact.get(key);
    if (body) {
      const smartId = parseSmartAliasMarker(body);
      if (smartId) {
        return { kind: "smart_alias", commands: [], smartAliasId: smartId };
      }
      const expanded = this.bodyParts(body);
      if (!expanded.ok) {
        return { kind: "blocked", commands: [], note: `Alias "${trimmed}": ${expanded.reason}` };
      }
      return this.flattenAliasParts(expanded.parts, depth + 1);
    }

    const withArg = trimmed.match(/^(\S+)\s+(.+)$/);
    if (withArg) {
      const stem = withArg[1].toLowerCase();
      const arg = withArg[2].trim();
      const prefixBody = this.prefix.get(stem);
      if (prefixBody && arg) {
        const smartId = parseSmartAliasMarker(prefixBody);
        if (smartId) {
          return {
            kind: "smart_alias",
            commands: [],
            smartAliasId: smartId,
            smartAliasArgs: arg,
          };
        }
        const expanded = this.bodyParts(prefixBody, { "1": arg });
        if (!expanded.ok) {
          return { kind: "blocked", commands: [], note: `Alias "${trimmed}": ${expanded.reason}` };
        }
        return this.flattenAliasParts(expanded.parts, depth + 1);
      }

      const exactBody = this.exact.get(stem);
      if (exactBody && arg) {
        const smartId = parseSmartAliasMarker(exactBody);
        if (smartId) {
          return {
            kind: "smart_alias",
            commands: [],
            smartAliasId: smartId,
            smartAliasArgs: arg,
          };
        }
        const expanded = this.bodyParts(exactBody);
        if (!expanded.ok) {
          return { kind: "blocked", commands: [], note: `Alias "${trimmed}": ${expanded.reason}` };
        }
        return this.flattenAliasParts(withTrailingArg(expanded.parts, arg), depth + 1);
      }
    }

    const expanded = expandVariables(trimmed, this.options.variables);
    const bits = splitDelayTokens(expanded);
    if (!bits.ok) return { kind: "blocked", commands: [], note: bits.reason };
    return { kind: "command", commands: bits.parts.length ? bits.parts : [expanded] };
  }

  resolveInput(line: string): AliasResolveResult {
    const trimmed = line.trim();
    if (!trimmed) {
      return { kind: "command", commands: [] };
    }

    const key = trimmed.toLowerCase();
    const isWholeLineAlias = this.zscript.has(key) || this.exact.has(key);
    const parts =
      isWholeLineAlias ? [trimmed] : splitCommands(trimmed, this.options.commandSeparator);

    if (parts.length <= 1) {
      return this.resolveSegment(parts[0] ?? trimmed);
    }

    const segments = parts.map((part) => this.resolveSegment(part));
    const needsSequence = segments.some(
      (s) => s.kind === "smart_alias" || s.kind === "blocked",
    );
    if (needsSequence) {
      return { kind: "sequence", commands: [], segments };
    }

    const commands = segments.flatMap((s) => s.commands);
    const zscriptSkipped = segments.flatMap((s) => s.zscriptSkipped ?? []);
    return {
      kind: segments.some((s) => s.kind === "alias") ? "alias" : "command",
      commands,
      zscriptSkipped: zscriptSkipped.length > 0 ? zscriptSkipped : undefined,
    };
  }

  plainAliasCount(): number {
    return this.exact.size;
  }

  /** True when `name` is an exact, prefix-stem or zScript alias. */
  hasAlias(name: string): boolean {
    const k = name.trim().toLowerCase();
    return this.exact.has(k) || this.prefix.has(k) || this.zscript.has(k);
  }

  listPlainAliases(limit = 50): string[] {
    return [...this.exact.keys()].sort().slice(0, limit);
  }

  /** Distinct alias triggers for UI autocomplete (exact, prefix stems, zScript). */
  listAutocompleteNames(): string[] {
    const names = new Set<string>();
    for (const k of this.exact.keys()) names.add(k);
    for (const k of this.prefix.keys()) names.add(k);
    for (const k of this.zscript.keys()) names.add(k);
    return [...names].sort((a, b) => a.localeCompare(b));
  }
}
