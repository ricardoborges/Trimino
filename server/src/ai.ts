// Jogadores IA. O servidor calcula as jogadas válidas (com a pontuação de cada uma) e o modelo da
// DeepSeek escolhe entre elas pensando na estratégia. Sem chave, com erro ou demora, o robô fica
// com a jogada de maior pontuação: a partida nunca trava esperando a IA.

import { fullSet, tileSum, type Move, type TriminoGame } from "@trimino/shared";

const API_URL = "https://api.deepseek.com/chat/completions";
/** Lido na hora: no Workers o ambiente chega pelos bindings. */
export const model = (): string => process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
const TIMEOUT_MS = 10_000; // acima disso o robô joga a melhor pontuação para não segurar a partida
const MAX_CANDIDATES = 12;

export const aiEnabled = (): boolean => !!process.env.DEEPSEEK_API_KEY;

interface Candidate {
  move: Move;
  points: number;
  bonuses: string[];
}

export interface Usage {
  prompt: number;
  completion: number;
  reasoning: number;
  total: number;
}

/** A jogada escolhida e quanto custou escolhê-la. */
export interface Choice {
  move: Move;
  points: number;
  source: "ia" | "melhor";
  note?: string;
  usage: Usage | null;
  ms: number;
}

const TILES = fullSet();
const tileText = (tileId: number) => TILES[tileId].v.join("-");

/** Escolhe a jogada do robô `playerId` (que precisa ter ao menos uma jogada válida). */
export async function chooseMove(game: TriminoGame, playerId: string): Promise<Choice> {
  const candidates: Candidate[] = game
    .validMoves(playerId)
    .map((move) => ({ move, ...game.evaluate(move) }))
    // mais pontos primeiro; no empate, livrar-se da peça mais pesada
    .sort((a, b) => b.points - a.points || tileSum(TILES[b.move.tileId]) - tileSum(TILES[a.move.tileId]));
  if (candidates.length === 0) throw new Error("sem jogadas válidas");
  const best = candidates[0];
  const fallback = (note: string, usage: Usage | null = null, ms = 0): Choice =>
    ({ move: best.move, points: best.points, source: "melhor", note, usage, ms });
  if (candidates.length === 1) return fallback("jogada única");
  if (!aiEnabled()) return fallback("sem chave da IA");

  // Uma opção por peça/pontuação, para a lista ficar curta e variada.
  const seen = new Set<string>();
  const options = candidates.filter((c) => {
    const k = `${c.move.tileId}:${c.points}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_CANDIDATES);
  if (options.length === 1) return fallback("jogada única");

  const started = performance.now();
  const answer = await askModel(game, playerId, options);
  const ms = Math.round(performance.now() - started);
  if ("error" in answer) {
    console.warn(`[ia] usando a melhor pontuação (${answer.error})`);
    return fallback(answer.error, answer.usage, ms);
  }
  const chosen = options[answer.index];
  const name = game.player(playerId)?.name;
  const tokens = answer.usage ? `, ${answer.usage.total} tokens` : "";
  console.log(`[ia] ${name} escolheu a opção ${answer.index + 1} de ${options.length} (${chosen.points} pts${tokens})`);
  return { move: chosen.move, points: chosen.points, source: "ia", note: `opção ${answer.index + 1} de ${options.length}`, usage: answer.usage, ms };
}

type Answer = { index: number; usage: Usage | null } | { error: string; usage: Usage | null };

interface ApiResponse {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** Pergunta ao modelo; nunca lança: devolve a opção escolhida ou o motivo da falha (com os tokens já gastos). */
async function askModel(game: TriminoGame, playerId: string, options: Candidate[]): Promise<Answer> {
  const me = game.player(playerId)!;
  const others = game.active.filter((p) => p.id !== playerId);
  const situation = {
    meta: game.targetScore,
    meusPontos: me.score,
    minhaMao: me.hand.map((t) => t.v.join("-")),
    adversarios: others.map((p) => ({ pontos: p.score, pecasNaMao: p.hand.length })),
    pecasNoMonte: game.pool.length,
    opcoes: options.map((c, i) => ({
      i,
      peca: tileText(c.move.tileId),
      pontos: c.points,
      bonus: c.bonuses.length ? c.bonuses.join(", ") : undefined,
    })),
  };

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: model(),
        reasoning_effort: "low",
        // o raciocínio conta nesse limite; com pouco espaço a resposta sai vazia
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Você joga Triminó (dominó triangular). Cada peça jogada vale a soma dos números; ponte vale +40 e mandala (fechar um hexágono) +50; cada pedra comprada na vez desconta 5 da jogada. " +
              "Quem esvazia a mão primeiro (bate) ganha 25; depois cada adversário joga uma última vez, e as pedras que sobram na mão de cada um saem dos pontos dele e vão para quem bateu. Escolha a melhor jogada entre as opções, " +
              "equilibrando pontos agora com livrar-se de peças pesadas e não deixar a mão travada. " +
              'Responda só com JSON: {"jogada": <índice i da opção>}.',
          },
          { role: "user", content: JSON.stringify(situation) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as Error;
    return { error: e.name === "TimeoutError" ? "tempo esgotado" : `falha de rede (${e.message})`, usage: null };
  }
  if (!res.ok) return { error: `HTTP ${res.status}`, usage: null };
  let data: ApiResponse;
  try {
    data = (await res.json()) as ApiResponse;
  } catch {
    return { error: "resposta ilegível", usage: null };
  }
  const u = data.usage;
  const usage: Usage | null = u
    ? {
        prompt: u.prompt_tokens ?? 0,
        completion: u.completion_tokens ?? 0,
        reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
        total: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
      }
    : null;
  let index = NaN;
  try {
    index = Number((JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { jogada?: unknown }).jogada);
  } catch {
    /* tratado abaixo */
  }
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return { error: "resposta inválida", usage };
  return { index, usage };
}
