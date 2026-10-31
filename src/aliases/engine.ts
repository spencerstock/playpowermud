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
  out = out.replace(/@(\w+)/g, (_, name: string) => variables[name] ?? "");
  return out;
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
      const withVars = expanded.commands.map((cmd) =>
        expandVariables(cmd, this.options.variables),
      );
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
      const expanded = expandVariables(body, this.options.variables);
      return this.flattenAliasParts(
        splitCommands(expanded, this.options.commandSeparator),
        depth + 1,
      );
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
        const expanded = expandVariables(prefixBody, this.options.variables, { "1": arg });
        return this.flattenAliasParts(
          splitCommands(expanded, this.options.commandSeparator),
          depth + 1,
        );
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
        const expanded = expandVariables(exactBody, this.options.variables);
        const suffixed = splitCommands(expanded, this.options.commandSeparator).map((cmd) =>
          cmd ? `${cmd} ${arg}` : arg,
        );
        return this.flattenAliasParts(suffixed, depth + 1);
      }
    }

    return { kind: "command", commands: [expandVariables(trimmed, this.options.variables)] };
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
