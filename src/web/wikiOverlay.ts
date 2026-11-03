const WIKI_CLOSE_MESSAGE = "playpowermud-wiki-close";

export type WikiOverlay = {
  open: (path?: string) => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
};

function normalizeWikiPath(path: string): string {
  const url = new URL(path, window.location.origin);
  if (!url.pathname.startsWith("/wiki")) return "/wiki/";
  return `${url.pathname}${url.search}`;
}

/** Full-screen wiki reader over the game UI; keeps the MUD page (and relay) alive. */
export function createWikiOverlay(opts?: { defaultPath?: string; onClose?: () => void }): WikiOverlay {
  const root = document.createElement("div");
  root.className = "wiki-overlay";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Wiki");

  const bar = document.createElement("div");
  bar.className = "wiki-overlay-bar";

  const title = document.createElement("span");
  title.className = "wiki-overlay-title";
  title.textContent = "Wiki";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "wiki-overlay-close";
  closeBtn.textContent = "Close";
  closeBtn.title = "Return to game (Escape)";

  bar.append(title, closeBtn);

  const iframe = document.createElement("iframe");
  iframe.className = "wiki-overlay-frame";
  iframe.title = "Play Powermud wiki";
  iframe.setAttribute("referrerpolicy", "same-origin");

  root.append(bar, iframe);
  document.body.append(root);

  let open = false;
  let path = normalizeWikiPath(opts?.defaultPath ?? "/wiki/");

  function setOpen(on: boolean): void {
    if (open === on) return;
    open = on;
    root.hidden = !on;
    document.body.classList.toggle("wiki-overlay-open", on);
    if (on) {
      iframe.src = path;
      closeBtn.focus();
    } else {
      opts?.onClose?.();
    }
  }

  closeBtn.addEventListener("click", () => setOpen(false));

  window.addEventListener("message", (ev: MessageEvent) => {
    if (ev.origin !== window.location.origin) return;
    if (ev.data?.type === WIKI_CLOSE_MESSAGE) setOpen(false);
  });

  return {
    open(nextPath?: string) {
      if (nextPath) path = normalizeWikiPath(nextPath);
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    toggle() {
      setOpen(!open);
    },
    isOpen() {
      return open;
    },
  };
}
