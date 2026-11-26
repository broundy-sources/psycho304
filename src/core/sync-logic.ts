// Logique pure de synchronisation (testée sans réseau).
// Dépôt distant :
//   progression/<appareil>.json  — sauvegarde complète de la progression connue de cet appareil
//                                  (chaque appareil n'écrit que son propre fichier : aucun conflit)
//   contenus/<paquet>.json       — paquets importés à la main sur un appareil (copie brute)
// Fusion : union des réponses (par identifiant), sessions et réglages = la plus récente gagne.

import type { Attempt, SessionRecord } from "./types";
import type { PackRow, SettingRow, Snapshot } from "./backup";

export interface ProgressFile {
  format: "psycho304-progress";
  version: 1;
  device_id: string;
  device_label: string;
  updated_at: string;
  attempts: Attempt[];
  sessions: SessionRecord[];
  settings: SettingRow[];
}

export interface SyncedPackFile { format: "psycho304-synced-pack"; key: string; imported_at: string; raw: unknown }

const strip = <T extends object>(x: T): T => Object.fromEntries(Object.entries(x as any).filter(([k]) => !k.startsWith("_"))) as T;

export function buildProgressFile(s: Pick<Snapshot, "attempts" | "sessions" | "settings">, deviceId: string, label: string, now = new Date().toISOString()): ProgressFile {
  return {
    format: "psycho304-progress",
    version: 1,
    device_id: deviceId,
    device_label: label,
    updated_at: now,
    attempts: s.attempts.map(strip).sort((a, b) => a.id.localeCompare(b.id)),
    sessions: s.sessions.map(strip).sort((a, b) => a.id.localeCompare(b.id)),
    settings: [...s.settings].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Empreinte du contenu utile (sans la date d'écriture) pour n'écrire que s'il y a du nouveau. */
export function progressFingerprint(f: Pick<ProgressFile, "attempts" | "sessions" | "settings">): string {
  return JSON.stringify([f.attempts, f.sessions, f.settings]);
}

export function parseProgressFile(text: string): ProgressFile | null {
  try {
    const j = JSON.parse(text);
    if (j?.format !== "psycho304-progress" || !Array.isArray(j.attempts)) return null;
    return { ...j, sessions: j.sessions ?? [], settings: j.settings ?? [] };
  } catch {
    return null;
  }
}

/** Regroupe plusieurs fichiers distants en un instantané (contenus vides). */
export function combineRemote(files: ProgressFile[]): Snapshot {
  const attempts = new Map<string, Attempt>();
  const sessions = new Map<string, SessionRecord>();
  const settings = new Map<string, SettingRow>();
  for (const f of files) {
    for (const a of f.attempts) if (!attempts.has(a.id)) attempts.set(a.id, a);
    for (const s of f.sessions) {
      const cur = sessions.get(s.id);
      if (!cur || s.updated_at > cur.updated_at) sessions.set(s.id, s);
    }
    for (const r of f.settings) {
      const cur = settings.get(r.key);
      if (!cur || r.updated_at > cur.updated_at) settings.set(r.key, r);
    }
  }
  return {
    content: { sources: [], parts: [], modules: [], concepts: [], courses: [], questions: [] },
    history: [],
    packs: [],
    attempts: [...attempts.values()],
    sessions: [...sessions.values()],
    settings: [...settings.values()],
  };
}

export const packFileName = (key: string) => `${key.replace(/[^a-z0-9-]/gi, "_")}.json`;

/** Paquets locaux à envoyer : importés à la main (ou reçus d'une sauvegarde), hors démonstration. */
export function packsToUpload(local: PackRow[], remoteNames: Set<string>): PackRow[] {
  return local.filter((p) => p.source !== "bundled" && (p.raw as any)?.pack?.kind === "content" && !remoteNames.has(packFileName(p.key)));
}
