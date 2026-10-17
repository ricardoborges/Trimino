-- Contas: e-mail e senha, Google, ou os dois (a conta do Google é ligada pelo e-mail verificado).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,              -- sempre em minúsculas
  name TEXT NOT NULL,
  password_hash TEXT,             -- pbkdf2-sha256$<iterações>$<sal>$<hash>, em base64
  google_sub TEXT UNIQUE,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);

-- Sessões: o cookie leva o token; aqui fica só o hash dele.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- sha-256 do token, em hex
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Mesas abertas na varanda. Cada mesa (Durable Object) atualiza a sua linha a cada mudança
-- e a cada minuto enquanto tiver gente; linhas sem atualização recente não aparecem.
CREATE TABLE mesas (
  code TEXT PRIMARY KEY,
  private INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL,          -- MesaSummary em JSON
  updated_at INTEGER NOT NULL
);
CREATE INDEX mesas_updated ON mesas(updated_at);

-- Partidas terminadas e o resultado de cada jogador (base das estatísticas e do ranking).
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  rounds INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);

CREATE TABLE match_players (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,  -- vazio para convidados e robôs
  name TEXT NOT NULL,
  bot INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL,
  position INTEGER NOT NULL,      -- 1 = maior pontuação
  won INTEGER NOT NULL DEFAULT 0,
  forfeited INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, name)
);
CREATE INDEX match_players_user ON match_players(user_id);
