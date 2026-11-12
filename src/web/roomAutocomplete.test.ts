import assert from "node:assert/strict";
import test from "node:test";
import {
  createRoomAutocomplete,
  parseSlashToLine,
  parseSlashWpLine,
  rankRoomHits,
  roomAcMaxHeightPx,
  roomHitLabel,
} from "./roomAutocomplete.js";

test("parseSlashWpLine", () => {
  assert.deepEqual(parseSlashWpLine("/wp 1"), { name: "1" });
  assert.deepEqual(parseSlashWpLine("/WP home"), { name: "home" });
  assert.deepEqual(parseSlashWpLine("/wp"), { name: "" });
  assert.equal(parseSlashWpLine("/wpx"), null);
  assert.equal(parseSlashWpLine("/to 1"), null);
});

test("parseSlashToLine", () => {
  assert.deepEqual(parseSlashToLine("/to"), { query: "" });
  assert.deepEqual(parseSlashToLine("/to "), { query: "" });
  assert.deepEqual(parseSlashToLine("/to market center"), { query: "market center" });
  assert.deepEqual(parseSlashToLine("/TO foo"), { query: "foo" });
  assert.equal(parseSlashToLine("/tom"), null);
  assert.equal(parseSlashToLine("/ca"), null);
  assert.equal(parseSlashToLine("to market"), null);
});

test("roomHitLabel prefers title", () => {
  assert.equal(roomHitLabel({ id: "v123", title: "Market Center" }), "Market Center (v123)");
  assert.equal(roomHitLabel({ id: "v123", label: "market" }), "market (v123)");
});

test("roomHitLabel tags room id before area in search title", () => {
  assert.equal(
    roomHitLabel({ id: "r9", title: "General Store - Nal Shaddar" }),
    "General Store (r9) - Nal Shaddar",
  );
});

test("rankRoomHits fuzzy re-ranks", () => {
  const hits = [
    { id: "a", title: "Academy Foyer" },
    { id: "b", title: "Market Center" },
  ];
  const ranked = rankRoomHits(hits, "mkt", 5);
  assert.equal(ranked[0]?.id, "b");
});

test("rankRoomHits orders by walk distance, then fuzzy score", () => {
  const hits = [
    { id: "far", title: "Market Center", distance: 12 },
    { id: "near", title: "East Market", distance: 2 },
    { id: "lost", title: "Market Ruins", distance: null },
    { id: "mid", title: "Market Gate", distance: 4 },
  ];
  const ranked = rankRoomHits(hits, "market", 12);
  assert.deepEqual(
    ranked.map((h) => h.id),
    ["near", "mid", "far", "lost"],
  );
});

test("rankRoomHits exact room id only", () => {
  const hits = [
    { id: "r9", title: "General Store" },
    { id: "r19", title: "Alley" },
    { id: "r109", title: "Dock" },
  ];
  const ranked = rankRoomHits(hits, "r9", 12);
  assert.deepEqual(ranked.map((h) => h.id), ["r9"]);
});

test("roomAcMaxHeightPx fits the space above the command field", () => {
  assert.equal(roomAcMaxHeightPx(400), 388);
  assert.equal(roomAcMaxHeightPx(60), 132);
  assert.equal(roomAcMaxHeightPx(0), null);
  assert.equal(roomAcMaxHeightPx(Number.NaN), null);
});

/** Minimal DOM stand-ins: just enough for createRoomAutocomplete's render and list events. */
function fakeDom() {
  type Listener = (e: { target: unknown; preventDefault: () => void }) => void;
  class FakeEl {
    className = "";
    textContent = "";
    hidden = false;
    dataset: Record<string, string> = {};
    attrs: Record<string, string> = {};
    children: FakeEl[] = [];
    parentElement: FakeEl | null = null;
    listeners: Record<string, Listener[]> = {};
    style = {
      props: {} as Record<string, string>,
      setProperty(k: string, v: string) {
        this.props[k] = v;
      },
      removeProperty(k: string) {
        delete this.props[k];
      },
    };
    classList = {
      el: this as FakeEl,
      add(c: string) {
        this.el.className = `${this.el.className} ${c}`.trim();
      },
      contains(c: string) {
        return this.el.className.split(/\s+/).includes(c);
      },
    };
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    }
    getAttribute(k: string) {
      if (k === "data-id") return this.dataset.id ?? null;
      return this.attrs[k] ?? null;
    }
    append(...els: FakeEl[]) {
      for (const el of els) {
        el.parentElement = this;
        this.children.push(el);
      }
    }
    appendChild(el: FakeEl) {
      this.append(el);
      return el;
    }
    replaceChildren() {
      this.children = [];
    }
    closest(sel: string): FakeEl | null {
      const cls = sel.replace(/^\./, "");
      let cur: FakeEl | null = this;
      while (cur) {
        if (cur.classList.contains(cls)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    scrollIntoView() {}
    getBoundingClientRect() {
      return { top: 300 };
    }
    addEventListener(type: string, fn: Listener) {
      (this.listeners[type] ??= []).push(fn);
    }
    dispatch(type: string, target: unknown) {
      let prevented = false;
      for (const fn of this.listeners[type] ?? []) {
        fn({ target, preventDefault: () => (prevented = true) });
      }
      return prevented;
    }
  }
  const g = globalThis as Record<string, unknown>;
  const prevDoc = g.document;
  const prevWin = g.window;
  g.document = { createElement: () => new FakeEl() };
  g.window = {};
  const wrap = new FakeEl();
  const listEl = new FakeEl();
  wrap.append(listEl);
  return {
    listEl,
    restore() {
      g.document = prevDoc;
      g.window = prevWin;
    },
  };
}

test("room autocomplete: tap (click) selects; mousedown only keeps input focus", async () => {
  const dom = fakeDom();
  try {
    const applied: string[] = [];
    let line = "/to mark";
    const ac = createRoomAutocomplete({
      listEl: dom.listEl as unknown as HTMLElement,
      getLineText: () => line,
      applyHit: (hit) => {
        applied.push(hit.id);
        line = `/to ${roomHitLabel(hit)}`;
      },
      search: async () => [
        { id: "r1", title: "Market Center", distance: 2 },
        { id: "r2", title: "Market Gate", distance: 5 },
      ],
      debounceMs: 0,
    });
    ac.refresh();
    await new Promise((r) => setTimeout(r, 10));
    const items = dom.listEl.children;
    assert.equal(items.length, 2);
    assert.equal(dom.listEl.style.props["--ac-fit-max-height"], "288px");
    const secondLabel = items[1]!.children[0]!;

    // Touch/mouse press on an option: keep focus, but do not select yet (could be a scroll drag).
    assert.equal(dom.listEl.dispatch("mousedown", secondLabel), true);
    assert.deepEqual(applied, []);
    // Press on the list's own scrollbar is left alone.
    assert.equal(dom.listEl.dispatch("mousedown", dom.listEl), false);

    // The tap's click picks the room the finger landed on.
    dom.listEl.dispatch("click", secondLabel);
    assert.deepEqual(applied, ["r2"]);
    assert.equal(ac.pendingWalkTargetId(), "r2");
    assert.equal(ac.isOpen(), false);
    assert.equal(dom.listEl.hidden, true);
  } finally {
    dom.restore();
  }
});

test("room autocomplete: tap pick calls onPick and stays closed until the line changes", async () => {
  const dom = fakeDom();
  try {
    let line = "/to mark";
    let picks = 0;
    let searches = 0;
    const ac = createRoomAutocomplete({
      listEl: dom.listEl as unknown as HTMLElement,
      getLineText: () => line,
      applyHit: (hit) => {
        line = `/to ${roomHitLabel(hit)}`;
      },
      onPick: () => {
        picks += 1;
        // app.ts syncs the field, which re-runs refresh() on the accepted line.
        ac.refresh();
      },
      search: async () => {
        searches += 1;
        return [
          { id: "r1", title: "Market Center", distance: 2 },
          { id: "r2", title: "Market Gate", distance: 5 },
        ];
      },
      debounceMs: 0,
    });
    ac.refresh();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(searches, 1);
    dom.listEl.dispatch("click", dom.listEl.children[1]!.children[0]!);
    assert.equal(picks, 1);
    assert.equal(line, "/to Market Gate (r2)");
    assert.equal(ac.pendingWalkTargetId(), "r2");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(searches, 1, "accepted line must not re-open the search");
    assert.equal(ac.isOpen(), false);
    assert.equal(dom.listEl.hidden, true);

    // Editing the line again searches again.
    line = "/to Market Gat";
    ac.refresh();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(searches, 2);
    assert.equal(ac.isOpen(), true);
  } finally {
    dom.restore();
  }
});

test("room autocomplete: Tab accept keeps the pending room and does not re-search", async () => {
  const dom = fakeDom();
  try {
    let line = "/to gate";
    let searches = 0;
    const ac = createRoomAutocomplete({
      listEl: dom.listEl as unknown as HTMLElement,
      getLineText: () => line,
      applyHit: (hit) => {
        line = `/to ${roomHitLabel(hit)}`;
      },
      search: async () => {
        searches += 1;
        return [{ id: "r2", title: "Market Gate", distance: 5 }];
      },
      debounceMs: 0,
    });
    ac.refresh();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ac.acceptSelected(), true);
    assert.equal(ac.refresh(), false);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(searches, 1);
    assert.equal(ac.pendingWalkTargetId(), "r2");
  } finally {
    dom.restore();
  }
});

test("rankRoomHits keeps hits that matched only an NPC name", () => {
  const hits = [
    { id: "r1", title: "Beggar's Alley", distance: 9 },
    { id: "r2", title: "You are standing somewhere in the desert", distance: 3, npcs: ["Beggar", "Lizard"], npcMatch: "Beggar" },
  ];
  assert.deepEqual(rankRoomHits(hits, "beggar", 12).map((h) => h.id), ["r2", "r1"]);
});
