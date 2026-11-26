// Client minimal de l'API GitHub (contenu d'un dépôt), utilisé pour la synchronisation
// et la sauvegarde distante. Aucune dépendance ; fonctionne dans le navigateur.

export interface GhConfig { owner: string; repo: string; token: string; branch?: string }
export interface GhEntry { name: string; path: string; sha: string; size: number; type: string }

export class GhError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const API = "https://api.github.com";

export class GitHub {
  constructor(private cfg: GhConfig, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private url(path: string) {
    const p = path.split("/").map(encodeURIComponent).join("/");
    return `${API}/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}/contents/${p}`;
  }

  private async req(method: string, url: string, body?: unknown, accept = "application/vnd.github+json"): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          Accept: accept,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GhError(0, "pas de connexion réseau");
    }
    if (res.ok || res.status === 404) return res;
    let detail = "";
    try {
      detail = (await res.json()).message ?? "";
    } catch {}
    const msg =
      res.status === 401 ? "jeton GitHub invalide ou expiré" :
      res.status === 403 ? `accès refusé par GitHub${detail ? ` (${detail})` : ""} — vérifier les droits du jeton (Contents : lecture et écriture)` :
      res.status === 409 || res.status === 422 ? "conflit d'écriture" :
      `erreur GitHub ${res.status}${detail ? ` : ${detail}` : ""}`;
    throw new GhError(res.status, msg);
  }

  async repoInfo(): Promise<{ full_name: string; private: boolean; canPush: boolean }> {
    const res = await this.req("GET", `${API}/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`);
    if (res.status === 404) throw new GhError(404, "dépôt introuvable (nom incorrect, ou jeton sans accès à ce dépôt)");
    const j = await res.json();
    return { full_name: j.full_name, private: !!j.private, canPush: j.permissions ? !!(j.permissions.push || j.permissions.admin) : true };
  }

  async list(dir: string): Promise<GhEntry[]> {
    const res = await this.req("GET", this.url(dir));
    if (res.status === 404) return [];
    const j = await res.json();
    return Array.isArray(j) ? j.filter((e: GhEntry) => e.type === "file") : [];
  }

  /** Contenu texte d'un fichier (null s'il n'existe pas). */
  async getText(path: string): Promise<string | null> {
    const res = await this.req("GET", this.url(path), undefined, "application/vnd.github.raw+json");
    if (res.status === 404) return null;
    return res.text();
  }

  /** Crée ou remplace un fichier. sha = version actuelle du fichier distant (obligatoire pour remplacer). */
  async put(path: string, text: string, message: string, sha?: string): Promise<string> {
    const res = await this.req("PUT", this.url(path), { message, content: toBase64Utf8(text), ...(sha ? { sha } : {}), ...(this.cfg.branch ? { branch: this.cfg.branch } : {}) });
    if (res.status === 404) throw new GhError(404, "dépôt introuvable ou jeton sans droit d'écriture");
    const j = await res.json();
    return j.content?.sha as string;
  }
}
