// Client minimal Supabase (Auth + REST/PostgREST), sans dépendance.
// La clé publique (publishable ou anon) va dans l'en-tête « apikey » ;
// le jeton de l'utilisateur connecté dans « Authorization: Bearer ».

export interface SbConfig { url: string; key: string }
export interface SbSession { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } }

export class SbError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

type Fetch = typeof fetch;

function frenchAuthError(status: number, body: any): string {
  const code = body?.error_code ?? body?.code ?? body?.error;
  const msg = String(body?.msg ?? body?.message ?? body?.error_description ?? "");
  if (code === "invalid_credentials" || code === "invalid_grant" && /credentials/i.test(msg)) return "e-mail ou mot de passe incorrect";
  if (code === "email_not_confirmed") return "adresse e-mail non confirmée (cocher « Auto Confirm User » en créant le compte dans Supabase)";
  if (code === "refresh_token_not_found" || code === "refresh_token_already_used" || /refresh token/i.test(msg)) return "session expirée : reconnectez-vous";
  if (status === 429) return "trop de tentatives : réessayez dans quelques minutes";
  if (status === 401 || status === 403) return /api ?key/i.test(msg) ? "clé publique Supabase invalide" : "accès refusé";
  return `erreur Supabase ${status}${msg ? ` : ${msg}` : ""}`;
}

export function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");
}

export class Supabase {
  private cfg: SbConfig;
  constructor(cfg: SbConfig, private fetchImpl: Fetch = (...a) => fetch(...a)) {
    this.cfg = { url: normalizeUrl(cfg.url), key: cfg.key.trim() };
  }

  private async call(path: string, init: RequestInit & { token?: string }, authApi = false): Promise<Response> {
    const headers: Record<string, string> = { apikey: this.cfg.key, ...(init.headers as Record<string, string>) };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchImpl(this.cfg.url + path, { ...init, headers, cache: "no-store" });
    } catch {
      throw new SbError(0, "pas de connexion au serveur (hors ligne, ou adresse du projet incorrecte)");
    }
    if (res.ok) return res;
    let body: any = null;
    try {
      body = await res.json();
    } catch {}
    if (authApi) throw new SbError(res.status, frenchAuthError(res.status, body), body?.error_code ?? body?.code);
    const msg = String(body?.message ?? "");
    if (res.status === 404 || body?.code === "42P01" || body?.code === "PGRST205")
      throw new SbError(res.status, "tables introuvables : exécuter le script supabase/schema.sql dans le SQL Editor", body?.code);
    if (res.status === 401 || body?.code === "PGRST301" || body?.code === "PGRST303") throw new SbError(401, "session expirée", body?.code);
    throw new SbError(res.status, `erreur Supabase ${res.status}${msg ? ` : ${msg}` : ""}`, body?.code);
  }

  private toSession(j: any): SbSession {
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at ?? Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600),
      user: { id: j.user?.id, email: j.user?.email },
    };
  }

  async signIn(email: string, password: string): Promise<SbSession> {
    const res = await this.call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: email.trim(), password }) }, true);
    return this.toSession(await res.json());
  }

  async refresh(refreshToken: string): Promise<SbSession> {
    const res = await this.call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }, true);
    return this.toSession(await res.json());
  }

  async signOut(token: string): Promise<void> {
    try {
      await this.call("/auth/v1/logout", { method: "POST", token }, true);
    } catch {}
  }

  /** Lecture paginée (PostgREST). */
  async select<T>(token: string, table: string, query: string): Promise<T[]> {
    const res = await this.call(`/rest/v1/${table}?${query}`, { method: "GET", token, headers: { Accept: "application/json" } });
    return res.json();
  }

  /** Insertion groupée ; ignore = ne jamais écraser une ligne existante, merge = mise à jour (le serveur garde la plus récente). */
  async upsert(token: string, table: string, rows: unknown[], onConflict: string, mode: "ignore" | "merge"): Promise<void> {
    if (!rows.length) return;
    await this.call(`/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      token,
      headers: { Prefer: `resolution=${mode === "ignore" ? "ignore-duplicates" : "merge-duplicates"},return=minimal`, "Content-Type": "application/json" },
      body: JSON.stringify(rows),
    });
  }
}
