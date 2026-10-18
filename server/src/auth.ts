// Contas e sessões. Senha com PBKDF2-SHA256 (WebCrypto); sessão num cookie HttpOnly cujo token
// só aparece no D1 como hash. Login com Google pelo fluxo "authorization code" do OAuth 2.0.

import type { UserInfo } from "@trimino/shared";

const SESSION_COOKIE = "trimino_sess";
const OAUTH_COOKIE = "trimino_oauth";
const SESSION_DAYS = 30;
/** O Workers aceita no máximo 100 mil iterações de PBKDF2. */
const PBKDF2_ITERATIONS = 100_000;

interface UserRow {
  id: string;
  email: string | null;
  name: string;
  password_hash: string | null;
  google_sub: string | null;
  avatar_url: string | null;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomToken = (bytes = 32) => b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
export const newId = () => crypto.randomUUID();

/** Administradores do site. Fixo no código; ADMIN_EMAILS (separados por vírgula) substitui a lista. */
const DEFAULT_ADMINS = "ricardoborges@gmail.com";
const adminEmails = () => (process.env.ADMIN_EMAILS || DEFAULT_ADMINS).split(",").map((e) => e.trim().toLowerCase());

/**
 * Só vale como administrador quem entrou com o Google: o cadastro com senha não confirma o e-mail,
 * então qualquer um poderia criar uma conta com o e-mail do administrador.
 */
const isAdmin = (u: UserRow) => !!u.email && !!u.google_sub && adminEmails().includes(u.email);

export const publicUser = (u: UserRow): UserInfo => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url, admin: isAdmin(u) });

/** Nome de jogador humano: "(IA)" é reservado para os robôs, para a marca ser confiável. */
export function humanName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\(\s*ia\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

// ---------------- senha ----------------

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256") return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const want = unb64(hash);
  return got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
}

// ---------------- sessão ----------------

const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

function cookie(req: Request, name: string, value: string, maxAge: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** Cria a sessão e devolve o Set-Cookie. */
async function startSession(db: D1Database, req: Request, userId: string): Promise<string> {
  const token = randomToken();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, Date.now() + SESSION_DAYS * 86_400_000)
    .run();
  return cookie(req, SESSION_COOKIE, token, SESSION_DAYS * 86_400);
}

/** Usuário da sessão do cookie, ou null (convidado ou sessão vencida). */
export async function currentUser(db: D1Database, req: Request): Promise<UserInfo | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await db
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?")
    .bind(await sha256(token), Date.now())
    .first<UserRow>();
  return row ? publicUser(row) : null;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });

// ---------------- e-mail e senha ----------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Requisição inválida.");
  }
}

export async function signup(db: D1Database, req: Request): Promise<Response> {
  const body = await readJson(req);
  const name = humanName(body.name);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!name) throw new HttpError(400, "Informe seu nome.");
  if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, "E-mail inválido.");
  if (password.length < 8) throw new HttpError(400, "A senha precisa ter pelo menos 8 caracteres.");
  if (password.length > 200) throw new HttpError(400, "Senha longa demais.");

  const existing = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
  if (existing) throw new HttpError(409, existing.password_hash ? "Já existe uma conta com esse e-mail." : "Esse e-mail já entra com o Google. Use o botão do Google.");
  const user: UserRow = { id: newId(), email, name, password_hash: await hashPassword(password), google_sub: null, avatar_url: null };
  await db
    .prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(user.id, user.email, user.name, user.password_hash, Date.now())
    .run();
  return json({ user: publicUser(user) }, { headers: { "set-cookie": await startSession(db, req, user.id) } });
}

export async function login(db: D1Database, req: Request): Promise<Response> {
  const body = await readJson(req);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "").slice(0, 200);
  const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
  // Mesmo erro para e-mail desconhecido e senha errada, para não revelar quem tem conta.
  if (!user?.password_hash || !(await checkPassword(password, user.password_hash))) throw new HttpError(401, "E-mail ou senha incorretos.");
  return json({ user: publicUser(user) }, { headers: { "set-cookie": await startSession(db, req, user.id) } });
}

export async function logout(db: D1Database, req: Request): Promise<Response> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  return json({ ok: true }, { headers: { "set-cookie": cookie(req, SESSION_COOKIE, "", 0) } });
}

// ---------------- Google ----------------

export interface GoogleConfig {
  clientId?: string;
  clientSecret?: string;
  publicUrl?: string;
}

export const googleEnabled = (g: GoogleConfig) => !!(g.clientId && g.clientSecret);
const redirectUri = (g: GoogleConfig, req: Request) => `${g.publicUrl ?? new URL(req.url).origin}/auth/google/callback`;
/** Só caminhos do próprio site depois do login (nada de redirecionar para fora). */
const safeNext = (next: string | null) => (next && /^\/[A-Za-z0-9/_?=&%-]*$/.test(next) && !next.startsWith("//") ? next : "/varanda");

export function googleStart(g: GoogleConfig, req: Request): Response {
  if (!googleEnabled(g)) throw new HttpError(404, "Login com Google não configurado.");
  const state = randomToken(16);
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: g.clientId!,
    redirect_uri: redirectUri(g, req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), "set-cookie": cookie(req, OAUTH_COOKIE, `${state}.${encodeURIComponent(next)}`, 600) },
  });
}

export async function googleCallback(db: D1Database, g: GoogleConfig, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const [state, nextRaw] = (readCookie(req, OAUTH_COOKIE) ?? "").split(".");
  const next = safeNext(decodeURIComponent(nextRaw ?? ""));
  const fail = (why: string) =>
    new Response(null, { status: 302, headers: { location: `/?erro=${encodeURIComponent(why)}`, "set-cookie": cookie(req, OAUTH_COOKIE, "", 0) } });
  if (!googleEnabled(g)) return fail("Login com Google não configurado.");
  if (url.searchParams.get("error")) return fail("Login com Google cancelado.");
  if (!state || url.searchParams.get("state") !== state) return fail("Sessão de login expirada. Tente de novo.");

  // O token vem direto do Google por TLS, então dá para confiar nos dados do userinfo.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: url.searchParams.get("code") ?? "",
      client_id: g.clientId!,
      client_secret: g.clientSecret!,
      redirect_uri: redirectUri(g, req),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail("Não foi possível entrar com o Google.");
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) return fail("Não foi possível ler sua conta do Google.");
  const info = (await infoRes.json()) as GoogleProfile;
  const user = await googleUser(db, info);
  const headers = new Headers({ location: next });
  headers.append("set-cookie", await startSession(db, req, user.id));
  headers.append("set-cookie", cookie(req, OAUTH_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

/**
 * App Android: o Credential Manager entrega um ID token do Google emitido para o nosso client ID (o da Web).
 * O tokeninfo do Google confere a assinatura e a validade; aqui conferimos para quem ele foi emitido.
 * Responde como o login com senha: o usuário no corpo e a sessão no Set-Cookie.
 */
export async function googleIdToken(db: D1Database, g: GoogleConfig, req: Request): Promise<Response> {
  if (!g.clientId) throw new HttpError(404, "Login com Google não configurado.");
  const idToken = String((await readJson(req)).idToken ?? "");
  if (!idToken || idToken.length > 4096) throw new HttpError(400, "Token do Google inválido.");
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) throw new HttpError(401, "Não foi possível entrar com o Google.");
  const claims = (await res.json()) as Record<string, string | undefined>;
  const issuerOk = claims.iss === "accounts.google.com" || claims.iss === "https://accounts.google.com";
  if (claims.aud !== g.clientId || !issuerOk || !claims.sub || Number(claims.exp) * 1000 < Date.now())
    throw new HttpError(401, "Não foi possível entrar com o Google.");
  const user = await googleUser(db, {
    sub: claims.sub,
    email: claims.email,
    email_verified: claims.email_verified === "true",
    name: claims.name,
    picture: claims.picture,
  });
  return json({ user: publicUser(user) }, { headers: { "set-cookie": await startSession(db, req, user.id) } });
}

/** Conta ligada ao perfil do Google: a mesma de antes, a de mesmo e-mail (confirmado) ou uma nova. */
async function googleUser(db: D1Database, info: GoogleProfile): Promise<UserRow> {
  const email = info.email_verified && info.email ? info.email.toLowerCase() : null;
  let user = await db.prepare("SELECT * FROM users WHERE google_sub = ?").bind(info.sub).first<UserRow>();
  if (!user && email) {
    // Mesma pessoa que já tinha conta com e-mail e senha: liga o Google a ela. A senha é apagada, porque o
    // cadastro com senha não confirma o e-mail: senão quem criou a conta antes com o e-mail de outra pessoa
    // continuaria entrando nela depois que o dono de verdade chegasse pelo Google.
    user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
    if (user) {
      await db
        .prepare("UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?), password_hash = NULL WHERE id = ?")
        .bind(info.sub, info.picture ?? null, user.id)
        .run();
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
      user = { ...user, google_sub: info.sub, password_hash: null };
    }
  }
  if (!user) {
    user = { id: newId(), email, name: humanName(info.name) || "Jogador", password_hash: null, google_sub: info.sub, avatar_url: info.picture ?? null };
    await db
      .prepare("INSERT INTO users (id, email, name, google_sub, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(user.id, user.email, user.name, user.google_sub, user.avatar_url, Date.now())
      .run();
  }
  return user;
}

export { json };
