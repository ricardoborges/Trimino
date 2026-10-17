// Protocolo JSON trocado por WebSocket em /ws.
// Mantenha em sincronia com android/app/src/main/java/com/example/trimino/net/Protocol.kt

import type { Tile, Values } from "./tiles.ts";

export type Phase = "lobby" | "lottery" | "playing" | "roundOver" | "gameOver";

/** Jogada válida (uso interno do servidor; não é enviada aos clientes para não dar dicas). */
export interface Move {
  tileId: number;
  r: number;
  c: number;
  rot: number;
  /** Valores resultantes nos vértices da célula (sentido horário). */
  vals: Values;
}

export interface Lottery {
  /** Quantas pedras viradas para baixo existem para escolher. */
  slots: number;
  picks: { playerId: string; slot: number; tile: Tile }[];
  /** Definido quando todos já tiraram; a rodada começa alguns segundos depois. */
  winnerId: string | null;
}

/**
 * Linha do histórico, estruturada para o cliente formatar.
 * Ex.: { actor: "Ana", action: "jogou", tile: [1, 5, 5], points: 11 } → "**Ana jogou:** <1-5-5> | +11"
 * Sem `actor`, é um aviso geral e `action` é o texto inteiro.
 */
export interface LogEntry {
  actor?: string;
  action: string;
  tile?: Values;
  points?: number;
  /** Detalhe extra, como os bônus ("ponte +40"). */
  note?: string;
}

export interface BoardCell {
  r: number;
  c: number;
  vals: Values;
  tileId: number;
  by: string;
}

export interface PlayerInfo {
  id: string;
  name: string;
  score: number;
  handCount: number;
  connected: boolean;
  isHost: boolean;
  spectator: boolean;
  /** Desistiu da partida. */
  out: boolean;
}

export interface RoundSummary {
  winnerId: string | null;
  reason: "emptyHand" | "blocked";
  points: number;
}

export interface GameState {
  room: string;
  phase: Phase;
  round: number;
  targetScore: number;
  players: PlayerInfo[];
  turnPlayerId: string | null;
  poolCount: number;
  board: BoardCell[];
  lottery: Lottery | null;
  log: LogEntry[];
  roundSummary: RoundSummary | null;
  /** Vencedor da partida, quando ela termina. */
  winnerId: string | null;
  you: {
    id: string;
    hand: Tile[];
    /**
     * Células livres encostadas (por aresta) em alguma peça — onde se pode TENTAR jogar.
     * Com o tabuleiro vazio, só a origem. Não indica se a peça encaixa.
     */
    frontier: { r: number; c: number }[];
    canDraw: boolean;
    canPass: boolean;
  };
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type SignalData =
  | { type: "offer" | "answer"; sdp: string }
  | { type: "ice"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

export type ClientMessage =
  | { t: "join"; room: string; name: string; clientId: string }
  | { t: "start" }
  | { t: "pickLot"; slot: number }
  | { t: "forfeit" }
  | { t: "nextRound" }
  | { t: "place"; tileId: number; r: number; c: number; rot: number }
  | { t: "draw" }
  | { t: "pass" }
  | { t: "chat"; text: string }
  | { t: "signal"; to: string; data: SignalData };

export type ServerMessage =
  /** `peers`: membros já conectados. Quem acaba de entrar envia a oferta WebRTC para cada um. */
  | { t: "welcome"; you: string; room: string; iceServers: IceServer[]; peers: string[] }
  | { t: "state"; state: GameState }
  | { t: "peerLeft"; id: string }
  | { t: "signal"; from: string; data: SignalData }
  | { t: "chat"; from: string; name: string; text: string }
  | { t: "error"; message: string };
