import { createCommsLogIngest, type CommsEntry } from "../game/commsLogIngest.js";
import { parseAnnounceLine, parseWhoLine } from "../game/discoveredPlayers.js";
import { GameStateTracker, type GameSnapshot } from "../game/GameState.js";
import { contentPathLooksLikePlayer, enrichRoomPlayers, knownPlayerRegistry } from "../game/players.js";
import { parsePowermudSocialLine } from "../game/socialLines.js";
import { GameStream } from "../game/stream.js";
import type { GameEvent } from "../game/types.js";
import { areaDisplayLabel, effectiveAreaId } from "../mapper/areaInfer.js";
import { Mapper, type MapperEvent } from "../mapper/Mapper.js";
import { roomDisplayTitle } from "../mapper/roomTitle.js";
import type { MapArea, MapRoom } from "../mapper/types.js";
import { stripAnsi } from "../session/scrollback.js";
import type { BrowserMapStore } from "./mapStore.js";

/** Trailing room lines (e.g. "There is one …") often follow the [HP:] prompt by a few ms. */
const ROOM_SETTLE_MS = 120;
const HEAL_EVERY = 50;
const COMMS_CAP = 400;
const COMMS_LS_PREFIX = "playpowermud-comms:";

export type RoomBrief = {
  id: string;
  title: string | null;
  exits: string[];
  unexplored: string[];
  area: string;
  areaLabel: string;
  tags: string[];
  pos: MapRoom["pos"];
  dark: boolean;
};

export type ClientGameSnapshot = GameSnapshot & { profile: null; room: RoomBrief | null; pendingCommands: number };

export type RuntimeMessage =
  | { type: "game"; game: ClientGameSnapshot }
  | { type: "map"; event: "moved" | "lost"; room: RoomBrief | null; created?: boolean; reason?: string };

export function roomBrief(room: MapRoom | undefined, areas: Record<string, MapArea> = {}): RoomBrief | null {
  if (!room) return null;
  const exits = room.exits ?? [];
  const links = room.links ?? {};
  const doc = { areas, version: 1 as const, mud: "", updatedAt: "", nextRoom: 0, nextPlane: 0, rooms: {}, planes: {} };
  return {
    id: room.id,
    title: roomDisplayTitle(room) ?? null,
    exits,
    unexplored: exits.filter((e) => !links[e]?.to),
    area: effectiveAreaId(room),
    areaLabel: areaDisplayLabel(doc, room),
    tags: room.tags ?? [],
    pos: room.pos,
    dark: room.dark ?? false,
  };
}

function normName(name: string): string {
  return name.trim().toLowerCase();
}

function commsKey(character: string | null): string {
  const safe = (character ?? "").trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64);
  return COMMS_LS_PREFIX + (safe || "_session");
}

/**
 * Browser port of the hub's GameRuntime: parses the MUD stream, tracks phase/vitals,
 * maps rooms live, and collects comms. One instance per tab / MUD session.
 */
export class ClientRuntime {
  readonly stream = new GameStream();
  readonly state = new GameStateTracker();
  readonly mapper: Mapper;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private arrivals = 0;
  private listeners = new Set<(msg: RuntimeMessage) => void>();
  private gameTimer: ReturnType<typeof setTimeout> | null = null;

  /** Names that count as players for says in the comms tab (tells/shouts always count). */
  private readonly players = new Set<string>([...knownPlayerRegistry().keys()]);
  private readonly comms = createCommsLogIngest(() => this.players);
  private commsKey: string | null = null;
  private commsEntries: CommsEntry[] = [];
  private commsListeners = new Set<(entry: CommsEntry | null, all: CommsEntry[]) => void>();

  constructor(readonly mapStore: BrowserMapStore) {
    this.mapper = new Mapper(mapStore.map);
    // Heal what earlier sessions left behind (duplicates, impossible links, ghost rooms).
    this.mapper.heal();
    if (mapStore.map.isDirty) mapStore.schedule();
    this.mapper.on((ev) => this.onMapperEvent(ev));
    this.state.on((ev) => this.onStateEvent(ev));
    this.loadComms();
  }

  on(fn: (msg: RuntimeMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(msg: RuntimeMessage): void {
    for (const fn of this.listeners) fn(msg);
  }

  // ---- MUD I/O hooks -------------------------------------------------------------------

  onConnected(): void {
    this.state.onConnect();
    this.mapper.reset();
    this.comms.reset();
    this.broadcastGame();
  }

  onDisconnected(): void {
    this.state.onDisconnect();
    this.mapper.reset();
    void this.mapStore.flush();
    this.broadcastGame();
  }

  onMudData(raw: string): void {
    this.ingestComms(raw);
    this.dispatch(this.stream.feed(raw));
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.dispatch(this.stream.settle());
    }, ROOM_SETTLE_MS);
  }

  /** Every wire line written to the MUD. */
  onCommandSent(line: string): void {
    if (this.state.phase === "in-game") this.mapper.onCommandSent(line);
  }

  private dispatch(events: GameEvent[]): void {
    const now = Date.now();
    for (const ev of events) {
      this.state.onEvent(ev, now);
      this.notePlayers(ev);
      const mapEv =
        ev.type === "room"
          ? { type: "room" as const, room: { ...ev.room, contents: enrichRoomPlayers(ev.room.contents, knownPlayerRegistry(), this.state.character, (n) => this.players.has(normName(n))) } }
          : ev;
      this.mapper.onGameEvent(mapEv, now);
    }
  }

  /** `who` rows, announces, tells/channels and player objects in rooms prove a name is a player. */
  private notePlayers(ev: GameEvent): void {
    if (ev.type === "line") {
      const plain = ev.text.trim();
      const who = parseWhoLine(plain);
      if (who) this.players.add(normName(who.name));
      const announced = parseAnnounceLine(plain);
      if (announced) this.players.add(normName(announced));
      const social = parsePowermudSocialLine(plain, this.state.character);
      if (social && (social.kind === "tell" || social.kind === "channel" || social.kind === "shout") && social.name !== "You") {
        this.players.add(normName(social.name));
      }
    } else if (ev.type === "room") {
      for (const c of ev.room.contents) {
        if (c.path && contentPathLooksLikePlayer(c.path)) this.players.add(normName(c.name.split(/\s+/)[0] ?? c.name));
      }
    }
  }

  private onStateEvent(ev: GameEvent): void {
    if (ev.type === "login" && (ev.stage === "account-menu" || ev.stage === "user-prompt")) {
      this.state.clearIdentity();
    }
    if (ev.type === "score" || ev.type === "login" || ev.type === "death") {
      this.loadComms();
      this.broadcastGame();
    } else if (ev.type === "vitals" || (ev.type === "prompt" && ev.vitals)) {
      this.broadcastGameThrottled();
    }
  }

  private broadcastGameThrottled(): void {
    if (this.gameTimer != null) return;
    this.gameTimer = setTimeout(() => {
      this.gameTimer = null;
      this.broadcastGame();
    }, 450);
  }

  broadcastGame(): void {
    if (this.gameTimer != null) {
      clearTimeout(this.gameTimer);
      this.gameTimer = null;
    }
    this.broadcast({ type: "game", game: this.snapshot() });
  }

  private onMapperEvent(ev: MapperEvent): void {
    if (ev.type === "moved") {
      if (ev.how === "exit" && ++this.arrivals % HEAL_EVERY === 0) this.mapper.heal();
      this.mapStore.schedule();
      this.broadcast({ type: "map", event: "moved", room: this.briefRoom(this.mapper.current()), created: ev.created });
    } else if (ev.type === "lost") {
      this.broadcast({ type: "map", event: "lost", room: null, reason: ev.reason });
    } else {
      this.mapStore.schedule();
    }
  }

  briefRoom(r: MapRoom | undefined): RoomBrief | null {
    return roomBrief(r, this.mapStore.map.doc.areas);
  }

  snapshot(): ClientGameSnapshot {
    return {
      ...this.state.snapshot(),
      profile: null,
      room: this.briefRoom(this.mapper.current()),
      pendingCommands: this.mapper.pendingCommands().length,
    };
  }

  // ---- comms -----------------------------------------------------------------------------

  onComms(fn: (entry: CommsEntry | null, all: CommsEntry[]) => void): () => void {
    this.commsListeners.add(fn);
    return () => this.commsListeners.delete(fn);
  }

  commsSnapshot(): CommsEntry[] {
    return this.commsEntries.slice();
  }

  clearComms(): void {
    this.commsEntries = [];
    this.saveComms();
    for (const fn of this.commsListeners) fn(null, []);
  }

  /** Comms are stored per character (localStorage); switch lists when the character changes. */
  private loadComms(): void {
    const key = commsKey(this.state.character);
    if (key === this.commsKey) return;
    this.commsKey = key;
    try {
      const raw = localStorage.getItem(key);
      this.commsEntries = raw ? (JSON.parse(raw) as CommsEntry[]).slice(-COMMS_CAP) : [];
    } catch {
      this.commsEntries = [];
    }
    for (const fn of this.commsListeners) fn(null, this.commsSnapshot());
  }

  private saveComms(): void {
    if (!this.commsKey) return;
    try {
      localStorage.setItem(this.commsKey, JSON.stringify(this.commsEntries));
    } catch {
      /* storage full or blocked: comms stay in memory */
    }
  }

  /** Comms parse whole lines only; a tell split across network chunks waits for its newline. */
  private commsPartial = "";

  private ingestComms(raw: string): void {
    const text = this.commsPartial + stripAnsi(raw);
    const nl = text.lastIndexOf("\n");
    if (nl < 0) {
      this.commsPartial = text.length > 4096 ? "" : text;
      return;
    }
    this.commsPartial = text.slice(nl + 1);
    const fresh = this.comms.ingestLogText(text.slice(0, nl + 1));
    if (!fresh.length) return;
    this.loadComms();
    for (const entry of fresh) {
      this.commsEntries.push(entry);
      if (this.commsEntries.length > COMMS_CAP) this.commsEntries.splice(0, this.commsEntries.length - COMMS_CAP);
      for (const fn of this.commsListeners) fn(entry, this.commsEntries);
    }
    this.saveComms();
  }
}
