// Arrastar as pedras da mão para mudar a ordem (mouse e toque), dentro ou fora da vez.
// A ordem é local: o servidor não precisa saber.

export interface HandDragOptions {
  /** O arrasto só começa quando isto devolve true. */
  canDrag(): boolean;
  /** Nova ordem das pedras (ids), quando o jogador solta. */
  onReorder(ids: number[]): void;
  /** Avisa quando o arrasto começa/termina, para a mão não ser redesenhada no meio. */
  onDragChange(active: boolean): void;
}

const START_DISTANCE = 6; // px antes de virar arrasto (abaixo disso é um clique)

export function enableHandDrag(container: HTMLElement, opts: HandDragOptions): { consumeClick(): boolean } {
  let pending: { el: HTMLElement; id: number; x: number; y: number; pointerId: number } | null = null;
  let ghost: HTMLElement | null = null;
  let offset = { x: 0, y: 0 };
  let dragged = false;
  let scrollTimer = 0;

  container.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".hand-tile");
    dragged = false; // um arrasto anterior que terminou fora da pedra não gerou clique
    if (!el || !opts.canDrag() || e.button > 0) return;
    pending = { el, id: Number(el.dataset.id), x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  });

  const begin = (e: PointerEvent) => {
    const el = pending!.el;
    const r = el.getBoundingClientRect();
    offset = { x: e.clientX - r.left, y: e.clientY - r.top };
    ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add("hand-ghost");
    ghost.style.width = `${r.width}px`;
    document.body.append(ghost);
    el.classList.add("placeholder");
    dragged = true;
    opts.onDragChange(true);
  };

  const move = (e: PointerEvent) => {
    if (!pending || e.pointerId !== pending.pointerId) return;
    if (!ghost) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < START_DISTANCE) return;
      begin(e);
    }
    e.preventDefault();
    ghost!.style.left = `${e.clientX - offset.x}px`;
    ghost!.style.top = `${e.clientY - offset.y}px`;

    // Coloca a pedra antes da primeira vizinha cujo centro está à direita do ponteiro.
    const el = pending.el;
    const others = [...container.querySelectorAll<HTMLElement>(".hand-tile")].filter((x) => x !== el);
    const before = others.find((x) => {
      const r = x.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2;
    });
    if (before) {
      if (el.nextElementSibling !== before) container.insertBefore(el, before);
    } else if (container.lastElementChild !== el) container.append(el);

    // Rola a mão quando o ponteiro chega perto das bordas.
    const box = container.getBoundingClientRect();
    const edge = e.clientX < box.left + 30 ? -1 : e.clientX > box.right - 30 ? 1 : 0;
    clearInterval(scrollTimer);
    if (edge) scrollTimer = window.setInterval(() => (container.scrollLeft += edge * 12), 16);
  };

  const end = (e: PointerEvent) => {
    if (!pending || e.pointerId !== pending.pointerId) return;
    clearInterval(scrollTimer);
    if (ghost) {
      ghost.remove();
      ghost = null;
      pending.el.classList.remove("placeholder");
      const ids = [...container.querySelectorAll<HTMLElement>(".hand-tile")].map((x) => Number(x.dataset.id));
      pending = null;
      opts.onDragChange(false);
      opts.onReorder(ids);
    } else pending = null;
  };

  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);

  return {
    /** true se o clique que acabou de acontecer era, na verdade, o fim de um arrasto (e deve ser ignorado). */
    consumeClick() {
      const was = dragged;
      dragged = false;
      return was;
    },
  };
}
