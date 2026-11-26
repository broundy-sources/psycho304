// Accès aux données de l'application : chargement, import, réponses, sauvegarde.

import { deleteDatabase, get, getAll, put, writeBatch, type StoreName } from "./idb";
import { planImport, packKey, summarizeCounts, type ImportPlan } from "../core/importer";
import { hkey, makeBackup, mergeBackup, type BackupFile, type HistoryRow, type MergeSummary, type PackRow, type SettingRow, type Snapshot } from "../core/backup";
import type { Attempt, ContentPack, ContentState, SessionRecord, Settings } from "../core/types";
import { COLLECTIONS, DEFAULT_SETTINGS, emptyContent } from "../core/types";

export const APP_VERSION = "0.1.0";

export interface AppData {
  content: ContentState;
  attempts: Attempt[];
  sessions: SessionRecord[];
  settings: Settings;
  settingRows: SettingRow[];
  packs: PackRow[];
  history: HistoryRow[];
  deviceId: string;
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function deviceId(): Promise<string> {
  const row = await get<{ key: string; value: string }>("meta", "device_id");
  if (row) return row.value;
  const id = uuid();
  await put("meta", { key: "device_id", value: id });
  return id;
}

export async function loadAll(): Promise<AppData> {
  const content = emptyContent();
  for (const c of COLLECTIONS) {
    for (const item of await getAll<any>(c)) (content[c] as Map<string, any>).set(item.id, item);
  }
  const settingRows = await getAll<SettingRow>("settings");
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const r of settingRows) if (r.key in settings) (settings as any)[r.key] = r.value;
  return {
    content,
    attempts: await getAll<Attempt>("attempts"),
    sessions: await getAll<SessionRecord>("sessions"),
    settings,
    settingRows,
    packs: await getAll<PackRow>("packs"),
    history: await getAll<HistoryRow>("history"),
    deviceId: await deviceId(),
  };
}

/** Demande au navigateur de ne pas effacer les données (important sur iPad / Safari). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function commitImport(pack: ContentPack, plan: ImportPlan, now = new Date().toISOString(), source: PackRow["source"] = "import"): Promise<void> {
  const ops: { store: StoreName; put: unknown }[] = [];
  for (const h of plan.history) ops.push({ store: "history", put: { ...h, hkey: hkey(h.collection, h.id, h.version) } });
  for (const w of plan.writes) ops.push({ store: w.collection, put: w.item });
  ops.push({ store: "packs", put: { key: plan.packKey, imported_at: now, raw: pack, report: summarizeCounts(plan.counts), source, _synced: source === "import" ? 0 : 1 } satisfies PackRow });
  await writeBatch(ops); // atomique : tout ou rien
}

export function previewImport(content: ContentState, pack: ContentPack): ImportPlan {
  return planImport(content, pack);
}

export { packKey };

export async function saveAttempt(a: Attempt): Promise<void> {
  await put("attempts", { ...a, _synced: 0 });
}

export async function saveSession(s: SessionRecord): Promise<void> {
  await put("sessions", { ...s, _synced: 0 });
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await put("settings", { key, value, updated_at: new Date().toISOString() } satisfies SettingRow);
}

export async function markRechecked(questionId: string, data: AppData): Promise<void> {
  const q = data.content.questions.get(questionId);
  if (!q) return;
  const { _needs_recheck, ...rest } = q;
  await put("questions", rest);
}

function snapshot(d: AppData): Snapshot {
  const content = Object.fromEntries(COLLECTIONS.map((c) => [c, [...(d.content[c] as Map<string, any>).values()]])) as Snapshot["content"];
  return { content, history: d.history, packs: d.packs, attempts: d.attempts, sessions: d.sessions, settings: d.settingRows };
}

export function exportBackup(d: AppData): BackupFile {
  return makeBackup(snapshot(d), APP_VERSION, d.deviceId);
}

export async function restoreBackup(d: AppData, backup: BackupFile): Promise<MergeSummary> {
  const { ops, summary } = mergeBackup(snapshot(d), backup);
  await writeBatch(ops as { store: StoreName; put: unknown }[]);
  return summary;
}

/** Supprime les données de démonstration (identifiants P0) et la progression associée. */
export async function purgeDemo(d: AppData): Promise<number> {
  const ops: { store: StoreName; del: IDBValidKey }[] = [];
  const isDemo = (id: string) => /^P0(-|$)/.test(id);
  for (const c of COLLECTIONS) for (const id of (d.content[c] as Map<string, any>).keys()) if (isDemo(id)) ops.push({ store: c, del: id });
  for (const a of d.attempts) if (isDemo(a.module_id)) ops.push({ store: "attempts", del: a.id });
  for (const s of d.sessions) if (s.question_ids.length && s.question_ids.every(isDemo)) ops.push({ store: "sessions", del: s.id });
  for (const h of d.history) if (isDemo(h.id)) ops.push({ store: "history", del: h.hkey });
  for (const p of d.packs) if ((p.raw as any)?.pack?.kind === "demo") ops.push({ store: "packs", del: p.key });
  await writeBatch(ops);
  return ops.length;
}

export async function resetEverything(): Promise<void> {
  await deleteDatabase();
}
