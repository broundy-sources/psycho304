// Faux serveur GitHub (API « contents ») en mémoire, pour tester la synchronisation sans réseau.
import { createHash } from "node:crypto";

export function createFakeGitHub({ owner = "etudiant", repo = "psycho304-donnees", token = "bon-jeton", isPrivate = true } = {}) {
  const files = new Map(); // path -> { text, sha }
  const commits = [];
  const sha = (t) => createHash("sha1").update(t).digest("hex");
  const prefix = `/repos/${owner}/${repo}`;

  function handle(method, urlStr, headers, bodyText) {
    const url = new URL(urlStr);
    const auth = headers["authorization"] ?? headers["Authorization"];
    if (auth !== `Bearer ${token}`) return { status: 401, json: { message: "Bad credentials" } };
    const path = decodeURIComponent(url.pathname);
    if (path === prefix && method === "GET") return { status: 200, json: { full_name: `${owner}/${repo}`, private: isPrivate, permissions: { push: true } } };
    if (!path.startsWith(prefix + "/contents/")) return { status: 404, json: { message: "Not Found" } };
    const p = path.slice((prefix + "/contents/").length);
    if (method === "GET") {
      const accept = headers["accept"] ?? headers["Accept"] ?? "";
      if (files.has(p)) {
        const f = files.get(p);
        if (accept.includes("raw")) return { status: 200, text: f.text };
        return { status: 200, json: { type: "file", name: p.split("/").pop(), path: p, sha: f.sha, size: f.text.length, content: Buffer.from(f.text).toString("base64") } };
      }
      const children = [...files.entries()].filter(([k]) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/"));
      if (!children.length) return { status: 404, json: { message: "Not Found" } };
      return { status: 200, json: children.map(([k, f]) => ({ type: "file", name: k.split("/").pop(), path: k, sha: f.sha, size: f.text.length })) };
    }
    if (method === "PUT") {
      const b = JSON.parse(bodyText);
      const text = Buffer.from(b.content, "base64").toString("utf8");
      const cur = files.get(p);
      if (cur && b.sha !== cur.sha) return { status: 409, json: { message: "sha mismatch" } };
      if (!cur && b.sha) return { status: 422, json: { message: "sha given for new file" } };
      const s = sha(text + commits.length);
      files.set(p, { text, sha: s });
      commits.push({ path: p, message: b.message });
      return { status: cur ? 200 : 201, json: { content: { sha: s, path: p } } };
    }
    return { status: 405, json: { message: "method" } };
  }

  /** Implémentation de fetch() pour les tests unitaires. */
  async function fetchImpl(url, init = {}) {
    const r = handle(init.method ?? "GET", String(url), init.headers ?? {}, init.body ?? "");
    const body = r.text ?? JSON.stringify(r.json);
    return new Response(body, { status: r.status, headers: { "Content-Type": r.text ? "text/plain" : "application/json" } });
  }

  return { files, commits, handle, fetchImpl, owner, repo, token };
}
