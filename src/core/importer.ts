// Fusion d'un paquet validé dans l'état des contenus. Fonction pure : ne supprime jamais rien.

import type { CollectionName, ContentPack, ContentState, Stored } from "./types";
import { COLLECTIONS } from "./types";

export interface HistoryEntry { id: string; version: number; collection: CollectionName; archived_at: string; data: unknown }

export interface ImportCounts { added: number; updated: number; unchanged: number; skipped: number }

export interface ImportPlan {
  packKey: string;
  counts: Record<CollectionName, ImportCounts>;
  writes: { collection: CollectionName; item: any }[];
  history: HistoryEntry[];
  warnings: string[];
}

export const packKey = (p: ContentPack) => `${p.pack.id}@${p.pack.version}`;

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v as object).filter((k) => !k.startsWith("_")).sort();
    return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as any)[k])).join(",")}}`;
  }
  return JSON.stringify(v);
}

const versionOf = (x: any): number | undefined => (typeof x?.version === "number" ? x.version : undefined);

/** Champs dont la modification impose une revérification pédagogique. */
function answerSignature(q: any): string {
  return stableStringify({ question: q.question, vignette: q.vignette, options: q.options, correct: q.correct_option_ids });
}

export function planImport(state: ContentState, pack: ContentPack, now = new Date().toISOString()): ImportPlan {
  const key = packKey(pack);
  const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, { added: 0, updated: 0, unchanged: 0, skipped: 0 }])) as Record<
    CollectionName,
    ImportCounts
  >;
  const writes: ImportPlan["writes"] = [];
  const history: HistoryEntry[] = [];
  const warnings: string[] = [];

  for (const coll of COLLECTIONS) {
    for (const incoming of (pack[coll] as any[] | undefined) ?? []) {
      const current = (state[coll] as Map<string, any>).get(incoming.id);
      const meta: Stored = { _pack: key, _updated_at: now };
      if (!current) {
        writes.push({ collection: coll, item: { ...incoming, ...meta } });
        counts[coll].added++;
        continue;
      }
      const same = stableStringify(current) === stableStringify(incoming);
      if (same) {
        counts[coll].unchanged++;
        continue;
      }
      const vIn = versionOf(incoming);
      const vCur = versionOf(current);
      const versioned = vIn !== undefined || vCur !== undefined;
      if (versioned) {
        const a = vIn ?? 1;
        const b = vCur ?? 1;
        if (a < b) {
          warnings.push(`${incoming.id} : version ${a} plus ancienne que la version installée (${b}) — ignorée`);
          counts[coll].skipped++;
          continue;
        }
        if (a === b) {
          warnings.push(`${incoming.id} : contenu modifié sans changement de version (${a}) — ignoré, incrémenter « version »`);
          counts[coll].skipped++;
          continue;
        }
        history.push({ id: current.id, version: b, collection: coll, archived_at: now, data: current });
      }
      const item: any = { ...incoming, ...meta };
      if (coll === "questions" && answerSignature(current) !== answerSignature(incoming)) item._needs_recheck = true;
      else if (current._needs_recheck) item._needs_recheck = true;
      writes.push({ collection: coll, item });
      counts[coll].updated++;
    }
  }
  return { packKey: key, counts, writes, history, warnings };
}

/** Applique un plan à un état en mémoire (copie). */
export function applyPlan(state: ContentState, plan: ImportPlan): ContentState {
  const next = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map(state[c] as Map<string, any>)])) as unknown as ContentState;
  for (const w of plan.writes) (next[w.collection] as Map<string, any>).set(w.item.id, w.item);
  return next;
}

export function summarizeCounts(counts: Record<CollectionName, ImportCounts>): string {
  const label: Record<CollectionName, string> = {
    sources: "sources",
    parts: "parties",
    modules: "modules",
    concepts: "notions",
    courses: "cours",
    questions: "questions",
  };
  const parts: string[] = [];
  for (const c of COLLECTIONS) {
    const k = counts[c];
    const bits = [k.added && `${k.added} ajout(s)`, k.updated && `${k.updated} mise(s) à jour`, k.skipped && `${k.skipped} ignoré(s)`].filter(Boolean);
    if (bits.length) parts.push(`${label[c]} : ${bits.join(", ")}`);
  }
  return parts.join(" · ") || "aucun changement";
}
