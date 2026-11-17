export type AppMenu = {
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
};

export function createAppMenu(btn: HTMLButtonElement, panel: HTMLElement): AppMenu {
  let open = false;

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.closest("header")?.classList.toggle("app-menu-open", open);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!open);
  });

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (target instanceof Element && target.closest("[data-keep-app-menu]")) return;
    if (!open) return;
    if (target instanceof Node && btn.contains(target)) return;
    if (target instanceof Node && panel.contains(target)) return;
    setOpen(false);
  });

  return {
    setOpen,
    isOpen: () => open,
  };
}