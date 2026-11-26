// Sauvegarde complète et fusion d'une sauvegarde (jamais d'écrasement destructif). Fonctions pures.

import type { Attempt, CollectionName, SessionRecord } from "./types";
import { COLLECTIONS } from "./types";

export interface SettingRow { key: string; value: unknown; updated_at: string }
export interface PackRow {
  key: string;
  imported_at: string;
  raw: unknown;
  report?: string;
  /** bundled = intégré à l'appli ; import = importé sur cet appareil ; sync = reçu d'un autre appareil */
  source?: "bundled" | "import" | "sync" | "backup";
  _synced?: 0 | 1;
}
export interface HistoryRow { hkey: string; id: string; version: number; collection: CollectionName; archived_at: string; data: unknown }

export interface Snapshot {
  content: Record<CollectionName, any[]>;
  history: HistoryRow[];
  packs: PackRow[];
  attempts: Attempt[];
  sessions: SessionRecord[];
  settings: SettingRow[];
}

export interface BackupFile extends Snapshot {
  format: "psycho304-backup";
  backup_version: 1;
  exported_at: string;
  app_version: string;
  device_id: string;
}

export const hkey = (collection: string, id: string, version: number) => `${collection}:${id}@${version}`;

export function makeBackup(s: Snapshot, appVersion: string, deviceId: string, now = new Date().toISOString()): BackupFile {
  const strip = <T>(x: T): T => {
    const { _synced, ...rest } = x as any;
    return rest as T;
  };
  return {
    format: "psycho304-backup",
    backup_version: 1,
    exported_at: now,
    app_version: appVersion,
    device_id: deviceId,
    ...s,
    attempts: s.attempts.map(strip),
    sessions: s.sessions.map(strip),
  };
}

export function isBackup(x: any): x is BackupFile {
  return !!x && x.format === "psycho304-backup" && x.backup_version === 1 && Array.isArray(x.attempts) && x.content && typeof x.content === "object";
}

export type StoreOp = { store: string; put: unknown };

export interface MergeSummary { attempts: number; sessions: number; settings: number; packs: number; content: number; history: number }

export function mergeBackup(current: Snapshot, incoming: Snapshot): { ops: StoreOp[]; summary: MergeSummary } {
  const ops: StoreOp[] = [];
  const summary: MergeSummary = { attempts: 0, sessions: 0, settings: 0, packs: 0, content: 0, history: 0 };

  const attIds = new Set(current.attempts.map((a) => a.id));
  for (const a of incoming.attempts) if (!attIds.has(a.id)) {
    ops.push({ store: "attempts", put: { ...a, _synced: 0 } });
    summary.attempts++;
  }

  const sess = new Map(current.sessions.map((s) => [s.id, s]));
  for (const s of incoming.sessions) {
    const cur = sess.get(s.id);
    if (!cur || s.updated_at > cur.updated_at) {
      ops.push({ store: "sessions", put: { ...s, _synced: 0 } });
      summary.sessions++;
    }
  }

  const sets = new Map(current.settings.map((s) => [s.key, s]));
  for (const s of incoming.settings) {
    const cur = sets.get(s.key);
    if (!cur || s.updated_at > cur.updated_at) {
      ops.push({ store: "settings", put: s });
      summary.settings++;
    }
  }

  const packs = new Set(current.packs.map((p) => p.key));
  for (const p of incoming.packs) if (!packs.has(p.key)) {
    ops.push({ store: "packs", put: p });
    summary.packs++;
  }

  const hist = new Set(current.history.map((h) => h.hkey));
  const addHistory = (h: HistoryRow) => {
    if (hist.has(h.hkey)) return;
    hist.add(h.hkey);
    ops.push({ store: "history", put: h });
    summary.history++;
  };
  incoming.history.forEach(addHistory);

  for (const coll of COLLECTIONS) {
    const cur = new Map((current.content[coll] ?? []).map((x: any) => [x.id, x]));
    for (const item of incoming.content[coll] ?? []) {
      const c = cur.get(item.id);
      const vIn = item.version ?? 1;
      const vCur = c?.version ?? 1;
      if (!c) {
        ops.push({ store: coll, put: item });
        summary.content++;
      } else if (vIn > vCur) {
        addHistory({ hkey: hkey(coll, c.id, vCur), id: c.id, version: vCur, collection: coll, archived_at: new Date().toISOString(), data: c });
        ops.push({ store: coll, put: item });
        summary.content++;
      }
    }
  }
  return { ops, summary };
}
