import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@trimino/shared";
import { Room, type Socket } from "./room.ts";

class FakeSocket implements Socket {
  readyState = 1;
  sent: ServerMessage[] = [];
  closeCode?: number;
  closeReason?: string;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

describe("Room resiliência e reconexão", () => {
  it("responde ping com pong e atualiza lastSeen", () => {
    const room = new Room("MESA1");
    const ws = new FakeSocket();
    const m = room.join(ws, "Ana", "cid-ana-1234", { userId: "u-ana" });
    m.lastSeen = 1000;
    room.handle(m, { t: "ping" });
    expect(ws.sent.at(-1)).toEqual({ t: "pong" });
    expect(m.lastSeen).toBeGreaterThan(1000);
  });

  it("jogador com conta recupera o assento mesmo se o WebSocket antigo ainda estiver pendurada (zumbi)", () => {
    const room = new Room("MESA2");
    const ws1 = new FakeSocket();
    const ws2 = new FakeSocket();
    const m1 = room.join(ws1, "Ana", "cid-aba-1", { userId: "u-ana" });
    const m2 = room.join(ws2, "Ana", "cid-aba-2", { userId: "u-ana" });
    expect(m2.id).toBe(m1.id);
    expect(m2.ws).toBe(ws2);
    expect(ws1.closeCode).toBe(4000);
  });

  it("mesma aba reconectando fecha o socket antigo com 1000 (sem falso aviso de outra janela)", () => {
    const room = new Room("MESA3");
    const ws1 = new FakeSocket();
    const ws2 = new FakeSocket();
    const m1 = room.join(ws1, "Ana", "cid-mesma-aba");
    const m2 = room.join(ws2, "Ana", "cid-mesma-aba");
    expect(m2.id).toBe(m1.id);
    expect(ws1.closeCode).toBe(1000);
  });

  it("convidado com resume recupera o assento se a conexão anterior ficou inativa (zumbi)", () => {
    const room = new Room("MESA4");
    const ws1 = new FakeSocket();
    const m1 = room.join(ws1, "Bia", "cid-bia-antigo");
    // Simula queda silenciosa há mais de 40s (sem TCP FIN)
    m1.lastSeen = Date.now() - 45_000;

    const ws2 = new FakeSocket();
    const m2 = room.join(ws2, "Bia", "cid-bia-novo", { resume: "cid-bia-antigo" });
    expect(m2.id).toBe(m1.id);
    expect(ws1.closeCode).toBe(1000);
  });

  it("durante a partida, jogador que caiu recupera o assento pelo nome mesmo sem resume ou entrando por Assistir", () => {
    const room = new Room("MESA5");
    const wsA = new FakeSocket();
    const wsB = new FakeSocket();
    const a = room.join(wsA, "Ana", "cid-ana-1111", { userId: "u-ana" });
    const b = room.join(wsB, "Bia", "cid-bia-1111");
    room.handle(a, { t: "start" });
    expect(room.game?.phase).toBe("lottery");

    // Bia perde a conexão e reabre em outro navegador clicando em Assistir (watch: true, sem resume)
    room.leave(b, wsB);
    const wsB2 = new FakeSocket();
    const b2 = room.join(wsB2, "bia", "cid-bia-outro-nav", { watch: true });
    expect(b2.id).toBe(b.id);
    expect(b2.watch).toBe(false);
    expect(b2.inCall).toBe(true);
    expect(room.stateFor(b2).players.find((p) => p.id === b.id)?.spectator).toBe(false);
  });

  it("toSnapshot e restore preservam a partida e os assentos quando todos caem temporariamente", () => {
    const room = new Room("MESA6");
    room.title = "Mesa da Família";
    const wsA = new FakeSocket();
    const wsB = new FakeSocket();
    const a = room.join(wsA, "Ana", "cid-ana-1111", { userId: "u-ana" });
    const b = room.join(wsB, "Bia", "cid-bia-1111");
    room.handle(a, { t: "start" });
    room.handle(a, { t: "pickLot", slot: 0 });
    room.handle(b, { t: "pickLot", slot: 1 });
    room.game!.beginFirstRound();

    const snap = JSON.parse(JSON.stringify(room.toSnapshot()));
    const restored = new Room("MESA6");
    restored.restore(snap);

    expect(restored.title).toBe("Mesa da Família");
    expect(restored.hasActiveMatch).toBe(true);
    expect(restored.game?.phase).toBe("playing");

    // Ana e Bia reconectam após a restauração e recuperam suas mãos e assentos
    const wsA2 = new FakeSocket();
    const a2 = restored.join(wsA2, "Ana", "cid-ana-novo", { userId: "u-ana" });
    expect(a2.id).toBe(a.id);
    expect(restored.stateFor(a2).you.hand).toHaveLength(9);
  });
});
