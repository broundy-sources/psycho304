// Moteur de synchronisation : tire les nouveautés du dépôt GitHub privé, les fusionne,
// puis envoie la progression de cet appareil et les paquets importés à la main.

import { get, put, writeBatch, type StoreName } from "../db/idb";
import { commitImport, loadAll, type AppData } from "../db/repo";
import { mergeBackup, type Snapshot } from "../core/backup";
import { parsePackText, validatePack } from "../core/pack-validator";
import { applyPlan, packKey, planImport } from "../core/importer";
import { buildProgressFile, combineRemote, packFileName, packsToUpload, parseProgressFile, progressFingerprint, type ProgressFile, type SyncedPackFile } from "../core/sync-logic";
import { COLLECTIONS } from "../core/types";
import { GhError, GitHub, type GhConfig } from "./github";

export interface SyncConfig extends GhConfig { device_label: string }
export interface SyncState { last_success?: string; last_error?: string; last_attempt?: string }
export interface SyncResult { pulledAttempts: number; pulledPacks: string[]; pushedProgress: boolean; pushedPacks: string[]; errors: string[] }

export async function getSyncConfig(): Promise<SyncConfig | null> {
  return ((await get<{ key: string; value: SyncConfig }>("meta", "sync_config"))?.value) ?? null;
}
export async function setSyncConfig(cfg: SyncConfig | null): Promise<void> {
  await put("meta", { key: "sync_config", value: cfg });
}
export async function getSyncState(): Promise<SyncState> {
  return ((await get<{ key: string; value: SyncState }>("meta", "sync_state"))?.value) ?? {};
}
async function setSyncState(s: SyncState) {
  await put("meta", { key: "sync_state", value: s });
}

function snapshotOf(d: AppData): Snapshot {
  const content = Object.fromEntries(COLLECTIONS.map((c) => [c, [...(d.content[c] as Map<string, any>).values()]])) as Snapshot["content"];
  return { content, history: d.history, packs: d.packs, attempts: d.attempts, sessions: d.sessions, settings: d.settingRows };
}

export async function runSync(cfg: SyncConfig, fetchImpl?: typeof fetch): Promise<SyncResult> {
  const gh = new GitHub(cfg, fetchImpl);
  const result: SyncResult = { pulledAttempts: 0, pulledPacks: [], pushedProgress: false, pushedPacks: [], errors: [] };
  const started = new Date().toISOString();
  const prev = await getSyncState();
  try {
    let data = await loadAll();

    // 1. Contenus importés sur d'autres appareils
    const remotePacks = await gh.list("contenus");
    const localKeys = new Set(data.packs.map((p) => p.key));
    const incoming: SyncedPackFile[] = [];
    for (const f of remotePacks) {
      const known = data.packs.some((p) => packFileName(p.key) === f.name);
      if (known) continue;
      const text = await gh.getText(f.path);
      try {
        const w = JSON.parse(text ?? "") as SyncedPackFile;
        if (w.format === "psycho304-synced-pack" && !localKeys.has(w.key)) incoming.push(w);
      } catch {
        result.errors.push(`${f.name} : fichier distant illisible`);
      }
    }
    incoming.sort((a, b) => a.imported_at.localeCompare(b.imported_at));
    let content = data.content;
    for (const w of incoming) {
      const parsed = parsePackText(JSON.stringify(w.raw));
      const v = validatePack(parsed.data, content);
      if (!v.ok) {
        result.errors.push(`${w.key} : refusé (${v.issues.find((i) => i.level === "error")?.message})`);
        continue;
      }
      const plan = planImport(content, v.pack!);
      await commitImport(v.pack!, plan, w.imported_at, "sync");
      content = applyPlan(content, plan);
      result.pulledPacks.push(packKey(v.pack!));
    }

    // 2. Progression des autres appareils (et sauvegarde de celui-ci)
    const remoteProg = await gh.list("progression");
    const files: ProgressFile[] = [];
    let ownText: string | null = null;
    const ownName = `${data.deviceId}.json`;
    for (const f of remoteProg) {
      const text = await gh.getText(f.path);
      if (f.name === ownName) ownText = text;
      const p = text ? parseProgressFile(text) : null;
      if (p) files.push(p);
      else result.errors.push(`${f.name} : fichier de progression illisible`);
    }
    data = await loadAll();
    const { ops, summary } = mergeBackup(snapshotOf(data), combineRemote(files));
    const writeOps = ops.filter((o) => o.store === "attempts" || o.store === "sessions" || o.store === "settings");
    if (writeOps.length) await writeBatch(writeOps.map((o) => ({ ...o, put: { ...(o.put as object), _synced: 1 } })) as { store: StoreName; put: unknown }[]);
    result.pulledAttempts = summary.attempts;

    // 3. Envoi des paquets importés à la main sur cet appareil
    data = await loadAll();
    const remoteNames = new Set(remotePacks.map((f) => f.name));
    for (const p of packsToUpload(data.packs, remoteNames)) {
      const body: SyncedPackFile = { format: "psycho304-synced-pack", key: p.key, imported_at: p.imported_at, raw: p.raw };
      await gh.put(`contenus/${packFileName(p.key)}`, JSON.stringify(body), `Paquet ${p.key}`);
      result.pushedPacks.push(p.key);
    }

    // 4. Envoi de la progression (si elle a changé)
    const mine = buildProgressFile(snapshotOf(data), data.deviceId, cfg.device_label);
    const remoteMine = ownText ? parseProgressFile(ownText) : null;
    if (!remoteMine || progressFingerprint(remoteMine) !== progressFingerprint(mine)) {
      const text = JSON.stringify(mine);
      const msg = `Progression ${cfg.device_label} — ${mine.attempts.length} réponse(s)`;
      const sha = remoteProg.find((f) => f.name === ownName)?.sha;
      try {
        await gh.put(`progression/${ownName}`, text, msg, sha);
      } catch (e) {
        if (!(e instanceof GhError) || (e.status !== 409 && e.status !== 422)) throw e;
        const fresh = (await gh.list("progression")).find((f) => f.name === ownName)?.sha;
        await gh.put(`progression/${ownName}`, text, msg, fresh);
      }
      result.pushedProgress = true;
    }
    await setSyncState({ ...prev, last_attempt: started, last_success: new Date().toISOString(), last_error: result.errors[0] });
  } catch (e) {
    const msg = (e as Error).message;
    await setSyncState({ ...prev, last_attempt: started, last_error: msg });
    throw e;
  }
  return result;
}
