// Conferência da batida: depois da comemoração, a mesa dá lugar às mãos de cada adversário, viradas
// para cima, e as contas aparecem passo a passo (pedra por pedra, soma, quanto sai de cada um e quanto
// entra para quem bateu), num ritmo que todos conseguem acompanhar.

import type { GameState, Values } from "@trimino/shared";

const TILE_MS = 550; // cada pedra que vira
const ROW_MS = 600; // pausa ao apresentar cada jogador
const SUM_MS = 900; // pausa depois de mostrar a soma da mão
const TRANSFER_MS = 1300; // pausa depois de passar os pontos para quem bateu
const FINAL_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Mostra um número com sinal: +12, −7 (com o sinal de menos tipográfico). */
const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

export class Settlement {
  readonly el: HTMLElement;
  /** Área de baixo (texto e botão da próxima rodada); quem chama preenche, e ela só aparece no fim. */
  readonly footer: HTMLElement;
  started = false;
  done = false;
  private aborted = false;

  constructor(
    private s: GameState,
    private tile: (v: Values) => Element,
    private colorOf: (playerId: string) => string,
  ) {
    this.el = el("div", "card settle");
    this.footer = el("div", "settle-footer");
    this.footer.hidden = true;
  }

  abort(): void {
    this.aborted = true;
  }

  /** Roda a animação; `onDone` é chamado no fim (para mostrar o botão da próxima rodada). */
  async play(onDone: () => void): Promise<void> {
    this.started = true;
    const s = this.s;
    const sum = s.roundSummary!;
    const name = (id: string | null) => s.players.find((p) => p.id === id)?.name ?? "?";
    const winner = name(sum.winnerId);
    const bonus = sum.bonus ?? 25;

    const title = el("h2", "settle-title", `🎉 ${winner} bateu!`);
    const winnerRow = el("div", "settle-winner appear");
    winnerRow.style.setProperty("--owner", this.colorOf(sum.winnerId ?? ""));
    const calc = el("span", "settle-calc", `${signed(bonus)} por bater`);
    const total = el("b", "settle-total");
    winnerRow.append(el("span", "settle-name", winner), calc, total);
    const rows = el("div", "settle-hands");
    this.el.append(title, winnerRow, rows, this.footer);
    await sleep(ROW_MS * 2);

    let running = bonus;
    for (const h of sum.hands ?? []) {
      if (this.aborted) return;
      const row = el("div", "settle-row appear");
      row.style.setProperty("--owner", this.colorOf(h.playerId));
      const tiles = el("span", "settle-tiles");
      const result = el("span", "settle-result");
      row.append(el("span", "settle-name", name(h.playerId)), tiles, result);
      rows.append(row);
      await sleep(ROW_MS);

      if (!h.tiles.length) {
        result.textContent = "sem pedras na mão";
        await sleep(SUM_MS);
        continue;
      }
      for (const v of h.tiles) {
        if (this.aborted) return;
        const t = el("span", "settle-tile flip");
        t.append(this.tile(v));
        t.title = v.join("-");
        tiles.append(t);
        await sleep(TILE_MS);
      }
      result.append(el("span", "settle-sum appear", `= ${h.sum}`));
      await sleep(SUM_MS);
      if (this.aborted) return;
      result.append(el("span", "settle-delta neg appear", signed(-h.sum)));
      running += h.sum;
      calc.append(el("span", "settle-add appear", ` ${signed(h.sum)}`));
      winnerRow.classList.remove("flash");
      void winnerRow.offsetWidth;
      winnerRow.classList.add("flash");
      await sleep(TRANSFER_MS);
    }
    if (this.aborted) return;

    total.textContent = `= ${signed(running)}`;
    total.classList.add("appear");
    await sleep(FINAL_MS);
    if (this.aborted) return;

    // placar depois do acerto
    const board = el("ol", "settle-scores appear");
    for (const p of [...s.players].filter((p) => !p.spectator).sort((a, b) => b.score - a.score)) {
      const li = el("li", "");
      li.style.setProperty("--owner", this.colorOf(p.id));
      li.append(el("span", "settle-name", p.name), el("b", "", String(p.score)));
      board.append(li);
    }
    rows.after(board);
    await sleep(ROW_MS);
    if (this.aborted) return;
    this.done = true;
    this.footer.hidden = false;
    onDone();
  }
}
