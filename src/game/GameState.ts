import type { CharacterStatus, GameEvent, LoginStage, Vitals } from "./types.js";

export type GamePhase =
  | "disconnected"
  | "connecting"
  | "login-user"
  | "login-password"
  | "account-menu"
  | "throw-out"
  | "new-user-warning"
  | "in-game";

export type GameSnapshot = {
  phase: GamePhase;
  character: string | null;
  vitals: Vitals | null;
  status: CharacterStatus | null;
  promptCount: number;
  lastPromptAt: number | null;
  inCombat: boolean;
  /** Last `You flee like the wind, <dir>!` (0 = never). */
  lastFleeAt: number;
  lastDeath: { who?: string; killer?: string; at: number } | null;
};

const LOGIN_PHASE: Partial<Record<LoginStage, GamePhase>> = {
  "user-prompt": "login-user",
  "password-prompt": "login-password",
  "account-menu": "account-menu",
  "throw-out": "throw-out",
  "new-user-warning": "new-user-warning",
  "bad-password": "login-user",
  "bad-character": "account-menu",
  "in-game": "in-game",
};

const COMBAT_WINDOW_MS = 6_000;
/** Powermud prints one attacker-less status line right after a successful flee. */
const FLEE_SETTLE_MS = 3_000;

type Waiter = { target: number; resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Session-level game state derived from the parsed stream: login phase, vitals from
 * prompts/combat lines, the last `score` snapshot, combat and death markers.
 */
export class GameStateTracker {
  phase: GamePhase = "disconnected";
  character: string | null = null;
  vitals: Vitals | null = null;
  status: CharacterStatus | null = null;
  promptCount = 0;
  lastPromptAt: number | null = null;
  lastCombatAt = 0;
  lastFleeAt = 0;
  lastDeath: GameSnapshot["lastDeath"] = null;
  /** Powermud emits score lines then a prompt; the prompt HP/SP can lag behind score. */
  private trustScoreVitalsOnNextPrompt = false;
  private promptWaiters = new Set<Waiter>();
  private listeners = new Set<(ev: GameEvent, snap: GameStateTracker) => void>();

  on(listener: (ev: GameEvent, snap: GameStateTracker) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onConnect(): void {
    this.phase = "connecting";
  }

  onDisconnect(): void {
    this.phase = "disconnected";
    this.clearIdentity();
    for (const w of this.promptWaiters) {
      clearTimeout(w.timer);
      w.resolve(false);
    }
    this.promptWaiters.clear();
  }

  setCharacter(name: string | null): void {
    this.character = name;
  }

  /**
   * Drop the previous character's score. A prompt merge keeps `status.name`, and that name
   * wins over `character` for bots — so a menu logout must clear it or the next login
   * still looks like whoever scored last.
   */
  clearIdentity(): void {
    this.character = null;
    this.status = null;
    this.vitals = null;
    this.lastDeath = null;
    this.lastCombatAt = 0;
  }

  onEvent(ev: GameEvent, at = Date.now()): void {
    switch (ev.type) {
      case "prompt":
        this.promptCount += 1;
        this.lastPromptAt = at;
        if (ev.status) this.status = { ...this.status, ...ev.status, promptStatusAt: at };
        if (ev.vitals) {
          let v = ev.vitals;
          if (this.trustScoreVitalsOnNextPrompt) {
            this.trustScoreVitalsOnNextPrompt = false;
            const { hp: _h, sp: _s, ...rest } = v;
            v = rest;
          }
          this.mergeVitals(v);
          if (this.phase !== "in-game") this.phase = "in-game";
        }
        for (const w of [...this.promptWaiters]) {
          if (this.promptCount >= w.target) {
            clearTimeout(w.timer);
            this.promptWaiters.delete(w);
            w.resolve(true);
          }
        }
        break;
      case "vitals": {
        this.mergeVitals(ev.vitals);
        const attacker = ev.vitals.attacker?.trim();
        // Only lines naming an opponent extend combat; attacker-less prompts are not a new fight.
        if (attacker) this.lastCombatAt = at;
        break;
      }
      case "flee":
        // Out of the room means out of the fight; a follower that re-engages prints a fresh status line.
        this.lastFleeAt = at;
        this.lastCombatAt = 0;
        break;
      case "room":
        if (this.phase !== "in-game") this.phase = "in-game";
        break;
      case "score":
        this.trustScoreVitalsOnNextPrompt = true;
        this.status = { ...this.status, ...ev.status };
        if (ev.status.name) this.character = ev.status.name;
        this.mergeVitals({
          hp: ev.status.hp,
          hpMax: ev.status.hpMax,
          sp: ev.status.sp,
          spMax: ev.status.spMax,
          pp: ev.status.pp,
          ppMax: ev.status.ppMax,
          at,
        });
        break;
      case "login": {
        const next = LOGIN_PHASE[ev.stage];
        if (next) this.phase = next;
        break;
      }
      case "death":
        if (!ev.who || !this.character || ev.who.toLowerCase() === this.character.toLowerCase()) {
          this.lastDeath = { who: ev.who, killer: ev.killer, at };
          this.lastCombatAt = 0;
        }
        break;
      case "kill":
        this.lastCombatAt = 0;
        break;
      default:
        break;
    }
    for (const l of this.listeners) {
      try {
        l(ev, this);
      } catch {
        // listener errors must not break parsing
      }
    }
  }

  private mergeVitals(v: Partial<Vitals>): void {
    const prev = this.vitals ?? { at: Date.now() };
    const next: Vitals = { ...prev, at: v.at ?? Date.now() };
    for (const k of ["hp", "hpMax", "sp", "spMax", "pp", "ppMax", "attacker"] as const) {
      if (v[k] !== undefined) (next as Record<string, unknown>)[k] = v[k];
    }
    // Prompts carry current values only; keep max from score/combat lines but never below current.
    if (next.hp !== undefined && next.hpMax !== undefined && next.hp > next.hpMax) next.hpMax = next.hp;
    if (next.sp !== undefined && next.spMax !== undefined && next.sp > next.spMax) next.spMax = next.sp;
    this.vitals = next;
    if (this.status) {
      if (next.hp !== undefined) this.status.hp = next.hp;
      if (next.sp !== undefined) this.status.sp = next.sp;
      if (next.pp !== undefined) this.status.pp = next.pp;
    }
  }

  get inCombat(): boolean {
    return Date.now() - this.lastCombatAt < COMBAT_WINDOW_MS;
  }

  /** Resolve true once `count` more prompts arrive (false on timeout/disconnect). */
  waitForPrompts(count: number, timeoutMs: number, since = this.promptCount): Promise<boolean> {
    const target = since + Math.max(0, count);
    if (this.promptCount >= target) return Promise.resolve(true);
    return new Promise((resolve) => {
      const w: Waiter = {
        target,
        resolve,
        timer: setTimeout(() => {
          this.promptWaiters.delete(w);
          resolve(false);
        }, timeoutMs),
      };
      this.promptWaiters.add(w);
    });
  }

  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      character: this.character,
      vitals: this.vitals,
      status: this.status,
      promptCount: this.promptCount,
      lastPromptAt: this.lastPromptAt,
      inCombat: this.inCombat,
      lastFleeAt: this.lastFleeAt,
      lastDeath: this.lastDeath,
    };
  }
}
