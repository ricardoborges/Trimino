// Jogadores IA. O servidor calcula as jogadas válidas (com a pontuação de cada uma) e o modelo da
// DeepSeek escolhe entre elas pensando na estratégia. Sem chave, com erro ou demora, o robô fica
// com a jogada de maior pontuação: a partida nunca trava esperando a IA.

import { fullSet, tileSum, type Move, type TriminoGame } from "@trimino/shared";

const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
const TIMEOUT_MS = 10_000; // acima disso o robô joga a melhor pontuação para não segurar a partida
const MAX_CANDIDATES = 12;

export const aiEnabled = (): boolean => !!process.env.DEEPSEEK_API_KEY;

interface Candidate {
  move: Move;
  points: number;
  bonuses: string[];
}

const TILES = fullSet();
const tileText = (tileId: number) => TILES[tileId].v.join("-");

/** Escolhe a jogada do robô `playerId` (que precisa ter ao menos uma jogada válida). */
export async function chooseMove(game: TriminoGame, playerId: string): Promise<Move> {
  const candidates: Candidate[] = game
    .validMoves(playerId)
    .map((move) => ({ move, ...game.evaluate(move) }))
    // mais pontos primeiro; no empate, livrar-se da peça mais pesada
    .sort((a, b) => b.points - a.points || tileSum(TILES[b.move.tileId]) - tileSum(TILES[a.move.tileId]));
  if (candidates.length === 0) throw new Error("sem jogadas válidas");
  const best = candidates[0].move;
  if (candidates.length === 1 || !aiEnabled()) return best;

  // Uma opção por peça/pontuação, para a lista ficar curta e variada.
  const seen = new Set<string>();
  const options = candidates.filter((c) => {
    const k = `${c.move.tileId}:${c.points}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_CANDIDATES);
  if (options.length === 1) return best;

  try {
    const index = await askModel(game, playerId, options);
    console.log(`[ia] ${game.player(playerId)?.name} escolheu a opção ${index + 1} de ${options.length} (${options[index].points} pts)`);
    return options[index]?.move ?? best;
  } catch (err) {
    console.warn(`[ia] usando a melhor pontuação (${(err as Error).message})`);
    return best;
  }
}

async function askModel(game: TriminoGame, playerId: string, options: Candidate[]): Promise<number> {
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

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: "low",
      // o raciocínio conta nesse limite; com pouco espaço a resposta sai vazia
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Você joga Triminó (dominó triangular). Cada peça jogada vale a soma dos números; ponte vale +40 e mandala (fechar um hexágono) +50; cada pedra comprada na vez desconta 5 da jogada. " +
            "Quem esvazia a mão primeiro ganha 25 + a soma das peças dos adversários. Escolha a melhor jogada entre as opções, " +
            "equilibrando pontos agora com livrar-se de peças pesadas e não deixar a mão travada. " +
            'Responda só com JSON: {"jogada": <índice i da opção>}.',
        },
        { role: "user", content: JSON.stringify(situation) },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { jogada?: unknown };
  const index = Number(parsed.jogada);
  if (!Number.isInteger(index) || index < 0 || index >= options.length) throw new Error("resposta inválida");
  return index;
}
