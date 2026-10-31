import { AliasEngine, type AliasResolveResult } from "../aliases/engine.js";

const ALIASES_LS = "playpowermud-aliases";

export type AliasStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Plain aliases (`/alias NAME EXPANSION`) kept in this browser's localStorage and resolved by
 * the copied mudwithme `AliasEngine` (`;` chains, `$1$`/`%1`/`%*` args, nested aliases, zScript subset).
 */
export class AliasStore {
  private aliases = new Map<string, string>();
  private readonly engine = new AliasEngine({ commandSeparator: ";", variables: {} });

  constructor(private readonly storage: AliasStorage | null = safeLocalStorage()) {
    this.load();
  }

  private load(): void {
    this.aliases.clear();
    try {
      const raw = this.storage?.getItem(ALIASES_LS);
      const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      for (const [name, body] of Object.entries(obj)) {
        if (typeof body === "string" && name.trim()) this.aliases.set(name, body);
      }
    } catch {
      /* corrupt or blocked storage: start empty */
    }
    this.engine.loadAliases(this.aliases);
  }

  private save(): void {
    this.engine.loadAliases(this.aliases);
    try {
      this.storage?.setItem(ALIASES_LS, JSON.stringify(Object.fromEntries(this.aliases)));
    } catch {
      /* aliases still work for this tab */
    }
  }

  /** Alias names are case-insensitive; a redefinition replaces the old body. */
  set(name: string, expansion: string): void {
    for (const k of this.aliases.keys()) if (k.toLowerCase() === name.toLowerCase()) this.aliases.delete(k);
    this.aliases.set(name, expansion);
    this.save();
  }

  remove(name: string): boolean {
    let removed = false;
    for (const k of [...this.aliases.keys()]) {
      if (k.toLowerCase() !== name.toLowerCase()) continue;
      this.aliases.delete(k);
      removed = true;
    }
    if (removed) this.save();
    return removed;
  }

  names(): string[] {
    return [...this.aliases.keys()].sort((a, b) => a.localeCompare(b));
  }

  list(filter = ""): [string, string][] {
    const f = filter.toLowerCase();
    return [...this.aliases.entries()]
      .filter(([n, b]) => !f || n.toLowerCase().includes(f) || b.toLowerCase().includes(f))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  /**
   * Input line → wire commands. `blocked` (expansion cycle) and smart-alias markers from
   * mudwithme bodies come back as an error note; everything else is a command list.
   */
  resolve(text: string): { commands: string[]; error?: string } {
    const r: AliasResolveResult = this.engine.resolveInput(text);
    const segments = r.kind === "sequence" && r.segments?.length ? r.segments : [r];
    const commands: string[] = [];
    for (const seg of segments) {
      if (seg.kind === "blocked") return { commands: [], error: seg.note ?? "Blocked" };
      if (seg.kind === "smart_alias") return { commands: [], error: `Smart aliases are not supported (${seg.smartAliasId})` };
      commands.push(...seg.commands);
    }
    return { commands };
  }
}

function safeLocalStorage(): AliasStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
