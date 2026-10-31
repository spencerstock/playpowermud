import { parseAreaHints } from "./areaInfer.js";
import { OVERWORLD_AREA, stripAnsi } from "./areaText.js";

export type PlaceLabelRoom = {
  title?: string | null;
  description?: string | null;
  /** Pre-built prose (title + description). */
  text?: string;
};

export type PlaceLabelTerm = { text: string; weight: number };

export type PlaceLabelPick = {
  label: string;
  terms?: PlaceLabelTerm[];
  usedFallback: boolean;
};

type HintAgg = {
  id: string;
  label: string;
  hits: number;
  confidenceSum: number;
  maxConfidence: number;
};

const AREA_ALIGN_BONUS = 1.5;
const MIN_SECONDARY_CONFIDENCE = 8;

function normalizeProse(raw: string): string {
  return stripAnsi(raw).replace(/\s+/g, " ").trim();
}

/** Room prose for place-hint parsing (ANSI stripped). */
export function roomPhraseText(title: string | null | undefined, description: string | null | undefined): string {
  const parts = [title ?? "", description ?? ""].filter(Boolean).map(normalizeProse).filter(Boolean);
  return parts.join("\n");
}

function proseForRoom(r: PlaceLabelRoom): string {
  return r.text ? normalizeProse(r.text.replace(/\n/g, " ")) : roomPhraseText(r.title, r.description);
}

function passesSupportGate(hits: number, blobSize: number): boolean {
  if (hits >= 2) return true;
  return blobSize > 0 && hits / blobSize >= 0.15;
}

function scoreAgg(agg: HintAgg, areaId: string): number {
  let score = agg.hits * 10 + agg.confidenceSum;
  if (agg.id === areaId) score *= AREA_ALIGN_BONUS;
  return score;
}

function aggregateHints(rooms: PlaceLabelRoom[]): HintAgg[] {
  const byId = new Map<string, HintAgg>();
  for (const r of rooms) {
    const text = proseForRoom(r);
    if (!text) continue;
    const perRoom = new Map<string, { label: string; confidence: number }>();
    for (const h of parseAreaHints(text)) {
      const prev = perRoom.get(h.id);
      if (!prev || h.confidence > prev.confidence) perRoom.set(h.id, { label: h.label, confidence: h.confidence });
    }
    for (const [id, { label, confidence }] of perRoom) {
      let agg = byId.get(id);
      if (!agg) {
        agg = { id, label, hits: 0, confidenceSum: 0, maxConfidence: 0 };
        byId.set(id, agg);
      }
      agg.hits += 1;
      agg.confidenceSum += confidence;
      agg.maxConfidence = Math.max(agg.maxConfidence, confidence);
    }
  }
  return [...byId.values()];
}

/**
 * Pick a display place name for a map blob from regex place hints only (no title mining, no IDF).
 */
export function pickPlaceLabel(rooms: PlaceLabelRoom[], areaId: string, areaLabel: string): PlaceLabelPick {
  const blobSize = rooms.length;
  const fallback = areaId === OVERWORLD_AREA ? "Overworld" : areaLabel || "Overworld";
  const aggs = aggregateHints(rooms);
  if (!aggs.length) {
    return { label: fallback, terms: [{ text: fallback, weight: 1 }], usedFallback: true };
  }

  const ranked = aggs
    .map((a) => ({ ...a, score: scoreAgg(a, areaId) }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)));

  const gatedCandidates = ranked.filter((c) => passesSupportGate(c.hits, blobSize));
  const subPlace = gatedCandidates.find(
    (c) =>
      c.id !== areaId &&
      c.maxConfidence >= MIN_SECONDARY_CONFIDENCE &&
      blobSize > 0 &&
      c.hits / blobSize >= 0.5,
  );
  const winner = subPlace ?? gatedCandidates[0] ?? ranked[0]!;
  const gated = gatedCandidates.length > 0 && passesSupportGate(winner.hits, blobSize);

  if (areaId === OVERWORLD_AREA) {
    if (!gated) {
      return { label: fallback, terms: [{ text: fallback, weight: 1 }], usedFallback: true };
    }
    const label = winner.label;
    const terms: PlaceLabelTerm[] = [{ text: label, weight: 1 }];
    const secondary = ranked.slice(1).find(
      (c) =>
        c.label !== label &&
        passesSupportGate(c.hits, blobSize) &&
        c.maxConfidence >= MIN_SECONDARY_CONFIDENCE,
    );
    if (secondary) terms.push({ text: secondary.label, weight: 0.75 });
    return { label, terms, usedFallback: false };
  }

  if (!gated) {
    return { label: fallback, terms: [{ text: fallback, weight: 1 }], usedFallback: true };
  }

  const label = winner.label;
  const terms: PlaceLabelTerm[] = [{ text: label, weight: 1 }];
  const secondary = ranked.find(
    (c) =>
      c.id !== winner.id &&
      c.label !== label &&
      passesSupportGate(c.hits, blobSize) &&
      c.maxConfidence >= MIN_SECONDARY_CONFIDENCE,
  );
  if (secondary) terms.push({ text: secondary.label, weight: 0.75 });
  return { label, terms, usedFallback: false };
}

