import { formatBriefRoomHint, parseBriefRoomLine } from "../game/briefRoom.js";

/** Parse HP/SP/images/stoneskins from plain scrollback (no live MUD). */

export type HpSpPair = {
  hp: number;
  hpMax: number;
  sp: number;
  spMax: number;
};

export function parseLatestHpSp(sb: string): HpSpPair {
  const lines = sb.split(/\r?\n/).reverse();
  let hp = 0;
  let hpMax = 0;
  let sp = 0;
  let spMax = 0;
  for (const line of lines) {
    const bar = line.match(/\[ HP : (\d+)\((\d+)\)/);
    if (bar) {
      hp = Number(bar[1]);
      hpMax = Number(bar[2]);
      const spBar = line.match(/SP : (\d+)\((\d+)\)/);
      if (spBar) {
        sp = Number(spBar[1]);
        spMax = Number(spBar[2]);
      }
      break;
    }
    const compact = line.match(/\[HP:\s*(\d+)(?:\((\d+)(?:\(\d+%\))?\))?\s+SP:\s*(\d+)(?:\((\d+)(?:\(\d+%\))?\))?/i);
    if (compact) {
      hp = Number(compact[1]);
      if (compact[2]) hpMax = Number(compact[2]);
      sp = Number(compact[3]);
      if (compact[4]) spMax = Number(compact[4]);
      break;
    }
    const hpOnly = line.match(/\[HP:\s*(\d+)/i);
    if (hpOnly) {
      hp = Number(hpOnly[1]);
      const spC = line.match(/SP:\s*(\d+)/i);
      if (spC) sp = Number(spC[1]);
      break;
    }
  }
  if (hpMax === 0) {
    const score = sb.match(/You have (\d+) out of (\d+) hit points/);
    if (score) {
      if (hp === 0) hp = Number(score[1]);
      hpMax = Number(score[2]);
    }
  }
  if (spMax === 0) {
    const scoreSp = sb.match(/You have (\d+) out of (\d+) spell points/i);
    if (scoreSp) {
      if (sp === 0) sp = Number(scoreSp[1]);
      spMax = Number(scoreSp[2]);
    }
  }
  return { hp, hpMax, sp, spMax };
}

export function parseWorstHp(sb: string): number {
  const nums: number[] = [];
  for (const m of sb.matchAll(/\[ HP : (\d+)\(/g)) nums.push(Number(m[1]));
  for (const m of sb.matchAll(/\[HP:\s*(\d+)/g)) nums.push(Number(m[1]));
  return nums.length ? Math.min(...nums) : 0;
}

export function parseWorstSp(sb: string): number {
  const nums: number[] = [];
  for (const m of sb.matchAll(/SP : (\d+)\(/g)) nums.push(Number(m[1]));
  for (const m of sb.matchAll(/SP:\s*(\d+)/g)) nums.push(Number(m[1]));
  return nums.length ? Math.min(...nums) : 0;
}

export function readImagesFromScrollback(sb: string): number {
  const rev = sb.split(/\r?\n/).reverse();
  for (const line of rev) {
    const n = line.match(/You have (\d+) images left/);
    if (n) return Number(n[1]);
    if (/One mirror image left/i.test(line)) return 1;
    const falseImg = line.match(/surrounded by (\d+) false images/i);
    if (falseImg) return Number(falseImg[1]);
  }
  const recent = sb.split(/\r?\n/).slice(-8).reverse();
  for (const line of recent) {
    if (/false images vanish/i.test(line)) return 0;
  }
  return 99;
}

export function readStoneskinsFromScrollback(sb: string): number {
  const rev = sb.split(/\r?\n/).reverse();
  for (const line of rev) {
    const n = line.match(/You have a total of (\d+) stoneskins remaining/i);
    if (n) return Number(n[1]);
    if (/You only have One stoneskin remaining/i.test(line)) return 1;
  }
  const recent = sb.split(/\r?\n/).slice(-8).reverse();
  for (const line of recent) {
    if (/LAST stoneskin|just lost your LAST stoneskin/i.test(line)) return 0;
  }
  return 99;
}

export function pct(now: number, max: number): number {
  if (max <= 0) return 0;
  return Math.floor((now * 100) / max);
}

/** Best-effort room/position label from recent scrollback (brief titles or `[ Exits: … ]` lines). */
export function parseLatestRoomHint(sb: string): string | null {
  const lines = sb.split(/\r?\n/).reverse();
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const brief = parseBriefRoomLine(t);
    if (brief) return formatBriefRoomHint(brief);
    const exits = t.match(/^(.+?)\s+\[\s*(?:Exits|exits)\b/i);
    if (exits?.[1]) return exits[1].trim();
  }
  return null;
}

export function scrollbackLooksLikeCombat(sb: string): boolean {
  const tail = sb.split(/\r?\n/).slice(-24).join("\n");
  return /Attacker\s*:/i.test(tail) || /\[ HP\s*:/i.test(tail) || /\[ HP :/i.test(tail);
}
