// O que fica no D1 além das contas: a lista de mesas da varanda e o resultado das partidas.

import type { MesaSummary, PlayerStats, RankingRow } from "@trimino/shared";
import type { MatchResult } from "./room.ts";

/** Mesas sem atualização há mais que isso somem da varanda (cada mesa atualiza a cada minuto). */
const STALE_MS = 3 * 60_000;

export async function publishMesa(db: D1Database, summary: MesaSummary, isPrivate: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mesas (code, private, summary, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(code) DO UPDATE SET private = ?2, summary = ?3, updated_at = ?4`,
    )
    .bind(summary.code, isPrivate ? 1 : 0, JSON.stringify(summary), summary.updatedAt)
    .run();
}

export async function removeMesa(db: D1Database, code: string): Promise<void> {
  await db.prepare("DELETE FROM mesas WHERE code = ?").bind(code).run();
}

export async function listMesas(db: D1Database): Promise<MesaSummary[]> {
  const { results } = await db
    .prepare("SELECT summary FROM mesas WHERE private = 0 AND updated_at > ? ORDER BY updated_at DESC LIMIT 100")
    .bind(Date.now() - STALE_MS)
    .all<{ summary: string }>();
  return results.map((r) => JSON.parse(r.summary) as MesaSummary);
}

/** Registra uma partida terminada. Só vale a pena se algum jogador tiver conta. */
export async function recordMatch(db: D1Database, r: MatchResult): Promise<void> {
  if (!r.players.some((p) => p.userId)) return;
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO matches (id, code, rounds, ended_at) VALUES (?, ?, ?, ?)").bind(id, r.code, r.rounds, Date.now()),
    ...r.players.map((p) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO match_players (match_id, user_id, name, bot, score, position, won, forfeited) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id, p.userId ?? null, p.name, p.bot ? 1 : 0, p.score, p.position, p.won ? 1 : 0, p.out ? 1 : 0),
    ),
  ]);
}

const STATS_COLUMNS = `
  COUNT(*) AS matches,
  COALESCE(SUM(mp.won), 0) AS wins,
  COALESCE(SUM(mp.forfeited), 0) AS forfeits,
  COALESCE(SUM(mp.score), 0) AS totalPoints,
  COALESCE(MAX(mp.score), 0) AS bestScore,
  COALESCE(SUM(m.rounds), 0) AS rounds,
  MAX(m.ended_at) AS lastPlayedAt`;

export async function playerStats(db: D1Database, userId: string): Promise<PlayerStats> {
  const row = await db
    .prepare(`SELECT ${STATS_COLUMNS} FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = ?`)
    .bind(userId)
    .first<PlayerStats>();
  return row ?? { matches: 0, wins: 0, forfeits: 0, totalPoints: 0, bestScore: 0, rounds: 0, lastPlayedAt: null };
}

/** Ranking por vitórias e, no empate, por pontos somados. */
export async function ranking(db: D1Database, limit = 50): Promise<RankingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id AS userId, u.name, u.avatar_url AS avatarUrl, ${STATS_COLUMNS}
       FROM match_players mp JOIN matches m ON m.id = mp.match_id JOIN users u ON u.id = mp.user_id
       GROUP BY u.id ORDER BY wins DESC, totalPoints DESC LIMIT ?`,
    )
    .bind(limit)
    .all<RankingRow>();
  return results;
}
