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
  /** Jogador IA controlado pelo servidor. */
  bot: boolean;
  /** Está na videoconferência (jogadores sempre; espectadores só com a permissão do anfitrião). */
  inCall?: boolean;
  /** Espectador pediu para entrar na videoconferência e aguarda o anfitrião. */
  callRequested?: boolean;
  /** Entrou sem conta (convidado). */
  guest?: boolean;
}

/** Anotação na folha de pontos: o total do jogador logo depois de pontuar (jogada, passe ou fim de rodada). */
export interface ScoreMark {
  round: number;
  total: number;
  /** Bônus de quem venceu a rodada. */
  roundWin?: boolean;
}

/** Uma jogada de robô no registro de tokens. */
export interface TokenEntry {
  round: number;
  bot: string;
  /** Pedra jogada e os pontos da jogada. */
  tile: Values;
  points: number;
  /** "ia": o modelo escolheu; "melhor": ficou com a maior pontuação sem chamar o modelo, ou porque ele falhou. */
  source: "ia" | "melhor";
  /** Detalhe: "opção 2 de 5", "jogada única", "sem chave", "tempo esgotado"... */
  note?: string;
  prompt: number;
  completion: number;
  /** Parte de `completion` gasta raciocinando. */
  reasoning: number;
  total: number;
  /** Tempo da chamada ao modelo (0 quando não chamou). */
  ms: number;
}

export interface TokenLog {
  model: string;
  /** Últimas jogadas (as mais antigas saem da lista, mas continuam somadas em `totals`). */
  entries: TokenEntry[];
  totals: { calls: number; prompt: number; completion: number; reasoning: number; total: number };
}

export interface RoundSummary {
  winnerId: string | null;
  reason: "emptyHand" | "blocked";
  /** Tudo o que o vencedor ganhou por vencer a rodada (na batida, inclui os +25). */
  points: number;
  /** Batida: o bônus por bater (+25). */
  bonus?: number;
  /** Batida: as pedras que sobraram na mão de cada adversário e a soma delas (para a conferência). */
  hands?: { playerId: string; tiles: Values[]; sum: number }[];
}

export interface GameState {
  room: string;
  /** Nome da mesa, escolhido por quem a criou na varanda. */
  title?: string;
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
  /** Folha de pontos, como a anotada no papel: uma coluna por jogador, um total a cada vez que ele pontua. */
  scoreSheet: { playerId: string; marks: ScoreMark[] }[];
  /**
   * Última ponte/mandala da rodada, para destacar as pedras e comemorar.
   * `seq` cresce a cada nova; o cliente só comemora quando vê um `seq` maior que o anterior.
   */
  celebration: {
    seq: number;
    playerId: string;
    points: number;
    formations: { kind: "ponte" | "mandala"; cells: { r: number; c: number }[] }[];
    /** A jogada foi a batida (o jogador colocou a última pedra da mão). */
    batida?: boolean;
  } | null;
  /** Depois de alguém bater: quem bateu e quem ainda vai jogar a última vez. */
  finalLap: { batedorId: string; pending: string[] } | null;
  /** Tokens gastos pelos jogadores IA nesta partida; null quando não há robô na mesa. */
  tokens: TokenLog | null;
  you: {
    id: string;
    hand: Tile[];
    /**
     * Células livres encostadas (por aresta) em alguma peça — onde se pode TENTAR jogar.
     * Com o tabuleiro vazio, só a origem. Não indica se a peça encaixa.
     */
    frontier: { r: number; c: number }[];
    canDraw: boolean;
    /** Quantas compras ainda cabem nesta vez. */
    drawsLeft?: number;
    canPass: boolean;
    /** Pode adicionar e remover jogadores IA (só o administrador do site). */
    canManageBots?: boolean;
  };
}

/**
 * O que o jogador da vez está fazendo antes de confirmar, para os outros acompanharem como numa mesa de verdade.
 * `index` é a posição da pedra na mão dele (na ordem que ele arrumou), contando da esquerda.
 */
export type Intent =
  | { kind: "idle" }
  /** Pegou uma pedra da mão. */
  | { kind: "select"; index: number }
  /** Segura a pedra sobre o tabuleiro, na célula (r, c), com o giro `rot` e os números `vals` (como ficariam ali). */
  | { kind: "preview"; index: number; r: number; c: number; rot: number; vals: Values }
  /** Abriu o monte para comprar; `slot`: a pedra que escolheu (posição no monte), enquanto a compra não chega. */
  | { kind: "pile"; slot?: number };

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type SignalData =
  | { type: "offer" | "answer"; sdp: string }
  | { type: "ice"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

export type ClientMessage =
  /** `watch`: entra como espectador (só assiste; não ocupa lugar na mesa). */
  /** `resume`: identidade usada antes nesta mesa (aba fechada sem querer); o servidor devolve o lugar se ele estiver vago. */
  | { t: "join"; room: string; name: string; clientId: string; resume?: string; watch?: boolean }
  /** Espectador: ocupa um lugar livre (fora de partida). */
  | { t: "sit" }
  /** Espectador: pede para entrar na videoconferência. */
  | { t: "requestCall" }
  /** Espectador: cancela o pedido ou sai da videoconferência. */
  | { t: "leaveCall" }
  /** Anfitrião: aceita ou recusa o pedido de um espectador. */
  | { t: "answerCall"; id: string; allow: boolean }
  /** Anfitrião: tira um espectador da videoconferência. */
  | { t: "endCall"; id: string }
  | { t: "start" }
  | { t: "pickLot"; slot: number }
  | { t: "forfeit" }
  /** Anfitrião tira um jogador da partida (ex.: ficou offline): conta como desistência, e a vez passa se for dele. */
  | { t: "removePlayer"; id: string }
  | { t: "addBot" }
  | { t: "removeBot"; id: string }
  | { t: "nextRound" }
  /** Anfitrião: dá as cartas de novo na rodada atual, desfazendo os pontos dela. */
  | { t: "restartRound" }
  /** Anfitrião: começa uma partida nova (novo sorteio, placar zerado) com quem está na mesa. */
  | { t: "restartGame" }
  | { t: "place"; tileId: number; r: number; c: number; rot: number }
  /** `slot`: qual pedra do monte (virada para baixo) o jogador escolheu; sem ele, a de cima. */
  | { t: "draw"; slot?: number }
  | { t: "pass" }
  /** Jogador da vez: o que está fazendo agora (o servidor repassa para os outros; não muda o jogo). */
  | { t: "intent"; intent: Intent }
  | { t: "signal"; to: string; data: SignalData };

export type ServerMessage =
  /**
   * `peers`: membros já na videoconferência. Quem acaba de entrar envia a oferta WebRTC para cada um.
   * `inCall`: false para espectadores, que só entram na conversa com a permissão do anfitrião.
   */
  | { t: "welcome"; you: string; room: string; iceServers: IceServer[]; peers: string[]; inCall?: boolean }
  /** Você entrou na videoconferência: envie a oferta para cada um de `peers`. */
  | { t: "call"; peers: string[] }
  /** Você saiu da videoconferência (por vontade própria ou pelo anfitrião). */
  | { t: "callEnded" }
  /** Aviso para mostrar ao usuário (não é erro). */
  | { t: "notice"; message: string }
  | { t: "state"; state: GameState }
  | { t: "peerLeft"; id: string }
  /** O que o jogador da vez (`from`) está fazendo; vale até a próxima intenção ou até a vez passar. */
  | { t: "intent"; from: string; intent: Intent }
  | { t: "signal"; from: string; data: SignalData }
  | { t: "error"; message: string };

// ---------------- API HTTP (site, varanda e contas) ----------------

/** Usuário da sessão. Convidados não têm conta: só um nome guardado no navegador. */
export interface UserInfo {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  /** Administrador do site (e-mail confirmado pelo Google): só ele mexe nos jogadores IA. */
  admin?: boolean;
}

/** Mesa aberta, como aparece na varanda. */
export interface MesaSummary {
  code: string;
  title: string;
  phase: Phase;
  round: number;
  /** Quem está sentado à mesa, na ordem da vez. */
  players: { name: string; score: number; bot: boolean; host: boolean; connected: boolean }[];
  spectators: number;
  /** Lugares livres para sentar agora (0 durante a partida). */
  seatsFree: number;
  updatedAt: number;
}

/** Estatísticas acumuladas de um jogador com conta (base para o ranking). */
export interface PlayerStats {
  matches: number;
  wins: number;
  forfeits: number;
  totalPoints: number;
  bestScore: number;
  rounds: number;
  lastPlayedAt: number | null;
}

export interface RankingRow extends PlayerStats {
  userId: string;
  name: string;
  avatarUrl: string | null;
}
