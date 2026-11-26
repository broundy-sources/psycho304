// Faux serveur Supabase en mémoire (Auth + PostgREST), reproduisant le comportement du schéma
// supabase/schema.sql : propriétaire = utilisateur connecté, numéros row_seq, « ignore » pour
// réponses et modules, « la plus récente gagne » pour sessions et réglages, jetons qui expirent.
import { randomUUID } from "node:crypto";

export function createFakeSupabase({ key = "sb_publishable_test", users = [{ email: "moi@exemple.fr", password: "motdepasse-test" }], accessTtl = 3600, maxRows = 1000 } = {}) {
  const userList = users.map((u) => ({ ...u, id: randomUUID() }));
  const access = new Map(); // token -> { uid, exp }
  const refresh = new Map(); // token -> uid
  const tables = { attempts: [], sessions: [], settings: [], content_packs: [] };
  let seq = 0;
  const stats = { refreshes: 0, requests: 0 };
  const state = { down: false, accessTtl };

  const json = (status, body) => ({ status, body: JSON.stringify(body), type: "application/json" });
  const issue = (u) => {
    const at = "at_" + randomUUID(), rt = "rt_" + randomUUID();
    const exp = Math.floor(Date.now() / 1000) + state.accessTtl;
    access.set(at, { uid: u.id, exp });
    refresh.set(rt, u.id);
    return { access_token: at, refresh_token: rt, token_type: "bearer", expires_in: state.accessTtl, expires_at: exp, user: { id: u.id, email: u.email } };
  };
  const conflictKeys = { attempts: ["id"], sessions: ["id"], settings: ["user_id", "key"], content_packs: ["user_id", "key"] };

  function handle(method, urlStr, headers, bodyText) {
    stats.requests++;
    const url = new URL(urlStr);
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (h.apikey !== key) return json(401, { message: "Invalid API key" });
    if ((h.authorization ?? "").includes("sb_publishable")) return json(401, { message: "Invalid JWT" });
    const path = url.pathname;

    if (path === "/auth/v1/token") {
      const body = JSON.parse(bodyText || "{}");
      if (url.searchParams.get("grant_type") === "password") {
        const u = userList.find((x) => x.email === body.email && x.password === body.password);
        if (!u) return json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        return json(200, issue(u));
      }
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const uid = refresh.get(body.refresh_token);
        if (!uid) return json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
        refresh.delete(body.refresh_token);
        stats.refreshes++;
        return json(200, issue(userList.find((x) => x.id === uid)));
      }
    }
    if (path === "/auth/v1/logout") return { status: 204, body: "", type: "text/plain" };

    const m = path.match(/^\/rest\/v1\/(\w+)$/);
    if (!m || !tables[m[1]]) return json(404, { code: "PGRST205", message: "Could not find the table" });
    const t = tables[m[1]];
    const tok = (h.authorization ?? "").replace(/^Bearer /, "");
    const sess = access.get(tok);
    if (!sess) return json(401, { code: "PGRST301", message: "No suitable key or wrong key type" });
    if (sess.exp < Date.now() / 1000) return json(401, { code: "PGRST303", message: "JWT expired" });
    const uid = sess.uid;

    if (method === "GET") {
      let rows = t.filter((r) => r.user_id === uid);
      for (const [k, v] of url.searchParams) {
        if (["select", "order", "limit"].includes(k)) continue;
        const [op, ...rest] = v.split(".");
        const val = rest.join(".");
        if (op === "gt") rows = rows.filter((r) => r[k] > Number(val));
        if (op === "eq") rows = rows.filter((r) => String(r[k]) === val);
      }
      rows = [...rows].sort((a, b) => a.row_seq - b.row_seq);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 1e9), maxRows); // comme « Max rows » de Supabase
      const cols = (url.searchParams.get("select") ?? "*").split(",");
      return json(200, rows.slice(0, limit).map((r) => (cols[0] === "*" ? r : Object.fromEntries(cols.map((c) => [c, r[c]])))));
    }
    if (method === "POST") {
      const rows = JSON.parse(bodyText);
      const prefer = h.prefer ?? "";
      const ignore = prefer.includes("ignore-duplicates");
      const keys = conflictKeys[m[1]];
      for (const raw of Array.isArray(rows) ? rows : [rows]) {
        if (raw.user_id && raw.user_id !== uid) return json(403, { code: "42501", message: "new row violates row-level security policy" });
        const row = { ...raw, user_id: uid };
        const existing = t.find((r) => keys.every((k) => r[k] === row[k]) && (keys.includes("user_id") || true));
        if (existing) {
          if (existing.user_id !== uid) continue; // collision d'identifiant avec un autre compte : sans effet
          if (ignore) continue;
          if (new Date(row.updated_at) <= new Date(existing.updated_at)) continue;
          Object.assign(existing, row, { row_seq: ++seq });
        } else {
          t.push({ ...row, row_seq: ++seq });
        }
      }
      return { status: 201, body: "", type: "text/plain" };
    }
    return json(405, { message: "method" });
  }

  return {
    key, users: userList, tables, stats, state, handle,
    revokeAll() { refresh.clear(); access.clear(); },
    async fetchImpl(url, init = {}) {
      if (state.down) throw new TypeError("Failed to fetch");
      const r = handle(init.method ?? "GET", String(url), init.headers ?? {}, init.body ?? "");
      return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: { "Content-Type": r.type } });
    },
  };
}
