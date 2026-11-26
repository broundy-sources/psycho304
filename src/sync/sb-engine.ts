// Synchronisation Supabase : envoi de tout ce qui n'a pas encore été envoyé (dont la migration
// initiale des données locales), puis réception incrémentale (numéros row_seq) des autres appareils.
// Rien n'est jamais supprimé : réponses et modules en ajout seul, sessions et réglages = le plus récent gagne.

import { get, getAll, put, writeBatch, type StoreName } from "../db/idb";
import { commitImport, loadAll } from "../db/repo";
import { parsePackText, validatePack } from "../core/pack-validator";
import { applyPlan, planImport } from "../core/importer";
import { packsToUpload } from "../core/sync-logic";
import type { Attempt, SessionRecord } from "../core/types";
import type { PackRow, SettingRow } from "../core/backup";
import { SbError, Supabase, type SbConfig, type SbSession } from "./supabase";

type Cursors = { attempts: number; sessions: number; settings: number; content_packs: number };
export interface SbState { cursors: Cursors; last_success?: string; last_error?: string; first_sync_at?: string }
export interface SbResult {
  pushed: { attempts: number; sessions: number; packs: number; settings: number };
  pulled: { attempts: number; sessions: number; packs: string[]; settings: number };
  errors: string[];
}

const PAGE = 1000;
const BATCH = 400;

// ——— Configuration, session ———

export async function getSbConfig(): Promise<SbConfig | null> {
  const stored = (await get<{ key: string; value: SbConfig }>("meta", "sb_config"))?.value;
  if (stored?.url && stored?.key) return stored;
  try {
    const res = await fetch("./supabase-config.json");
    if (res.ok) {
      const j = await res.json();
      if (j?.url && j?.key) return { url: j.url, key: j.key };
    }
  } catch {}
  return null;
}
export const setSbConfig = (cfg: SbConfig | null) => put("meta", { key: "sb_config", value: cfg });
export const getSbSession = async () => (await get<{ key: string; value: SbSession | null }>("meta", "sb_session"))?.value ?? null;
const setSbSession = (s: SbSession | null) => put("meta", { key: "sb_session", value: s });
export async function getSbState(userId: string): Promise<SbState> {
  return (await get<{ key: string; value: SbState }>("meta", `sb_state:${userId}`))?.value ?? { cursors: { attempts: 0, sessions: 0, settings: 0, content_packs: 0 } };
}
const setSbState = (userId: string, s: SbState) => put("meta", { key: `sb_state:${userId}`, value: s });

export async function sbSignIn(cfg: SbConfig, email: string, password: string, fetchImpl?: typeof fetch): Promise<SbSession> {
  const s = await new Supabase(cfg, fetchImpl).signIn(email, password);
  await setSbConfig(cfg);
  await setSbSession(s);
  return s;
}

/** Déconnexion : le jeton est oublié ; les données de l'appareil sont conservées. */
export async function sbSignOut(fetchImpl?: typeof fetch): Promise<void> {
  const cfg = await getSbConfig();
  const s = await getSbSession();
  if (cfg && s) await new Supabase(cfg, fetchImpl).signOut(s.access_token);
  await setSbSession(null);
}

async function validToken(sb: Supabase, force = false): Promise<SbSession> {
  const s = await getSbSession();
  if (!s) throw new SbError(401, "non connecté");
  if (!force && s.expires_at - 60 > Date.now() / 1000) return s;
  try {
    const fresh = await sb.refresh(s.refresh_token);
    await setSbSession(fresh);
    return fresh;
  } catch (e) {
    // Jeton de rafraîchissement refusé : il faut se reconnecter (les données locales restent intactes).
    if (e instanceof SbError && e.status >= 400 && e.status < 500) await setSbSession(null);
    throw e;
  }
}

// ——— Synchronisation ———

const clean = <T extends object>(x: T): T => {
  const o: any = {};
  for (const [k, v] of Object.entries(x)) if (!k.startsWith("_")) o[k] = v;
  return o;
};

async function selectAll<T extends { row_seq: number }>(sb: Supabase, token: string, table: string, cols: string, after: number): Promise<T[]> {
  const out: T[] = [];
  let cursor = after;
  for (;;) {
    const rows = await sb.select<T>(token, table, `select=${cols},row_seq&row_seq=gt.${cursor}&order=row_seq.asc&limit=${PAGE}`);
    if (!rows.length) break; // page vide = fin (robuste même si le serveur limite à moins de 1000 lignes)
    out.push(...rows);
    cursor = rows[rows.length - 1].row_seq;
  }
  return out;
}

async function syncOnce(sb: Supabase, session: SbSession): Promise<SbResult> {
  const token = session.access_token;
  const uid = session.user.id;
  const state = await getSbState(uid);
  const r: SbResult = { pushed: { attempts: 0, sessions: 0, packs: 0, settings: 0 }, pulled: { attempts: 0, sessions: 0, packs: [], settings: 0 }, errors: [] };

  // 1. ENVOI — modules importés (migration comprise)
  let data = await loadAll();
  const remoteKeys = new Set<string>();
  let after = 0;
  for (;;) {
    const rows = await sb.select<{ key: string; row_seq: number }>(token, "content_packs", `select=key,row_seq&row_seq=gt.${after}&order=row_seq.asc&limit=${PAGE}`);
    if (!rows.length) break;
    rows.forEach((x) => remoteKeys.add(x.key));
    after = rows[rows.length - 1].row_seq;
  }
  const candidates = packsToUpload(data.packs, new Set()).filter((p) => (p as any)._sb !== 1);
  for (const p of candidates.sort((a, b) => a.imported_at.localeCompare(b.imported_at))) {
    if (!remoteKeys.has(p.key)) {
      await sb.upsert(token, "content_packs", [{ key: p.key, imported_at: p.imported_at, data: p.raw }], "user_id,key", "ignore");
      r.pushed.packs++;
    }
    await put("packs", { ...p, _sb: 1 });
  }

  // 2. ENVOI — réponses, sessions, réglages non encore envoyés
  const attempts = (await getAll<Attempt & { _sb?: number }>("attempts")).filter((a) => a._sb !== 1);
  for (let i = 0; i < attempts.length; i += BATCH) {
    const chunk = attempts.slice(i, i + BATCH);
    await sb.upsert(token, "attempts", chunk.map((a) => ({ id: a.id, answered_at: a.answered_at, data: clean(a) })), "id", "ignore");
    await writeBatch(chunk.map((a) => ({ store: "attempts" as StoreName, put: { ...a, _sb: 1 } })));
    r.pushed.attempts += chunk.length;
  }
  const sessions = (await getAll<SessionRecord & { _sb?: number }>("sessions")).filter((s) => s._sb !== 1);
  for (let i = 0; i < sessions.length; i += BATCH) {
    const chunk = sessions.slice(i, i + BATCH);
    await sb.upsert(token, "sessions", chunk.map((s) => ({ id: s.id, updated_at: s.updated_at, data: clean(s) })), "id", "merge");
    await writeBatch(chunk.map((s) => ({ store: "sessions" as StoreName, put: { ...s, _sb: 1 } })));
    r.pushed.sessions += chunk.length;
  }
  const settings = (await getAll<SettingRow & { _sb?: number }>("settings")).filter((s) => s._sb !== 1);
  if (settings.length) {
    await sb.upsert(token, "settings", settings.map((s) => ({ key: s.key, value: s.value ?? null, updated_at: s.updated_at })), "user_id,key", "merge");
    await writeBatch(settings.map((s) => ({ store: "settings" as StoreName, put: { ...s, _sb: 1 } })));
    r.pushed.settings = settings.length;
  }

  // 3. RÉCEPTION — modules des autres appareils (dans l'ordre d'import)
  const packRows = await selectAll<{ key: string; imported_at: string; row_seq: number }>(sb, token, "content_packs", "key,imported_at", state.cursors.content_packs);
  data = await loadAll();
  const localKeys = new Set(data.packs.map((p) => p.key));
  let content = data.content;
  for (const row of packRows.filter((p) => !localKeys.has(p.key)).sort((a, b) => a.imported_at.localeCompare(b.imported_at))) {
    const [full] = await sb.select<{ data: unknown }>(token, "content_packs", `select=data&key=eq.${encodeURIComponent(row.key)}`);
    const parsed = parsePackText(JSON.stringify(full?.data ?? null));
    const v = validatePack(parsed.data, content);
    if (!v.ok) {
      r.errors.push(`module ${row.key} refusé : ${v.issues.find((i) => i.level === "error")?.message}`);
      continue;
    }
    const plan = planImport(content, v.pack!);
    await commitImport(v.pack!, plan, row.imported_at, "sync");
    content = applyPlan(content, plan);
    localKeys.add(row.key);
    r.pulled.packs.push(row.key);
  }
  if (packRows.length && !r.errors.some((e) => e.startsWith("module"))) state.cursors.content_packs = packRows[packRows.length - 1].row_seq;

  // 4. RÉCEPTION — réponses, sessions, réglages
  const remoteAtt = await selectAll<{ data: Attempt; row_seq: number }>(sb, token, "attempts", "data", state.cursors.attempts);
  const localAttIds = new Set((await getAll<Attempt>("attempts")).map((a) => a.id));
  const newAtt = remoteAtt.filter((x) => x.data?.id && !localAttIds.has(x.data.id));
  for (let i = 0; i < newAtt.length; i += BATCH) await writeBatch(newAtt.slice(i, i + BATCH).map((x) => ({ store: "attempts" as StoreName, put: { ...x.data, _sb: 1 } })));
  r.pulled.attempts = newAtt.length;
  if (remoteAtt.length) state.cursors.attempts = remoteAtt[remoteAtt.length - 1].row_seq;

  const remoteSess = await selectAll<{ data: SessionRecord; updated_at: string; row_seq: number }>(sb, token, "sessions", "data,updated_at", state.cursors.sessions);
  const localSess = new Map((await getAll<SessionRecord>("sessions")).map((s) => [s.id, s]));
  const sessOps = remoteSess.filter((x) => {
    const cur = localSess.get(x.data.id);
    return !cur || new Date(x.data.updated_at) > new Date(cur.updated_at);
  });
  if (sessOps.length) await writeBatch(sessOps.map((x) => ({ store: "sessions" as StoreName, put: { ...x.data, _sb: 1 } })));
  r.pulled.sessions = sessOps.length;
  if (remoteSess.length) state.cursors.sessions = remoteSess[remoteSess.length - 1].row_seq;

  const remoteSet = await selectAll<{ key: string; value: unknown; updated_at: string; row_seq: number }>(sb, token, "settings", "key,value,updated_at", state.cursors.settings);
  const localSet = new Map((await getAll<SettingRow>("settings")).map((s) => [s.key, s]));
  const setOps = remoteSet.filter((x) => {
    const cur = localSet.get(x.key);
    return !cur || new Date(x.updated_at) > new Date(cur.updated_at);
  });
  if (setOps.length) await writeBatch(setOps.map((x) => ({ store: "settings" as StoreName, put: { key: x.key, value: x.value, updated_at: new Date(x.updated_at).toISOString(), _sb: 1 } })));
  r.pulled.settings = setOps.length;
  if (remoteSet.length) state.cursors.settings = remoteSet[remoteSet.length - 1].row_seq;

  const now = new Date().toISOString();
  await setSbState(uid, { ...state, first_sync_at: state.first_sync_at ?? now, last_success: now, last_error: r.errors[0] });
  return r;
}

export async function runSbSync(fetchImpl?: typeof fetch): Promise<SbResult> {
  const cfg = await getSbConfig();
  if (!cfg) throw new SbError(0, "projet Supabase non configuré");
  const sb = new Supabase(cfg, fetchImpl);
  let session = await validToken(sb);
  try {
    try {
      return await syncOnce(sb, session);
    } catch (e) {
      if (!(e instanceof SbError) || e.status !== 401) throw e;
      session = await validToken(sb, true); // jeton expiré pendant la synchro : un seul nouvel essai
      return await syncOnce(sb, session);
    }
  } catch (e) {
    const st = await getSbState(session.user.id);
    await setSbState(session.user.id, { ...st, last_error: (e as Error).message });
    throw e;
  }
}

/** Nombre d'éléments locaux pas encore envoyés (pour l'affichage). */
export async function pendingCounts(): Promise<{ attempts: number; sessions: number; packs: number }> {
  const att = (await getAll<Attempt & { _sb?: number }>("attempts")).filter((a) => a._sb !== 1).length;
  const ses = (await getAll<SessionRecord & { _sb?: number }>("sessions")).filter((s) => s._sb !== 1).length;
  const packs = packsToUpload(await getAll<PackRow>("packs"), new Set()).filter((p) => (p as any)._sb !== 1).length;
  return { attempts: att, sessions: ses, packs };
}
