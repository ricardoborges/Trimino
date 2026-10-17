// Protocolo JSON trocado por WebSocket em /ws.
// Mantenha em sincronia com android/app/src/main/java/com/example/trimino/net/Protocol.kt

import type { Tile, Values } from "./tiles.ts";

export type Phase = "lobby" | "playing" | "roundOver" | "gameOver";

export interface Move {
  tileId: number;
  r: number;
  c: number;
  rot: number;
  /** Valores resultantes nos vértices da célula (sentido horário), prontos para desenhar. */
  vals: Values;
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
  /** Peça obrigatória para a primeira jogada da rodada (null depois dela). */
  openingTileId: number | null;
  log: string[];
  roundSummary: RoundSummary | null;
  you: {
    id: string;
    hand: Tile[];
    validMoves: Move[];
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
