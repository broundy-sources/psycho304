// Moteur de QCM : mélange, notation, construction des sessions. Fonctions pures.

import type { Attempt, ContentState, Question, ScoringRule, SessionConfig } from "./types";

// ——— Aléatoire reproductible ———

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ordre d'affichage des propositions (identifiants). Les bonnes réponses sont rattachées aux identifiants, jamais aux positions. */
export function displayOrder(q: Question, shuffleAllowed: boolean, rng: () => number = Math.random): string[] {
  const ids = q.options.map((o) => o.id);
  const canShuffle = shuffleAllowed && q.type !== "true_false" && q.shuffle_options !== false;
  return canShuffle ? shuffle(ids, rng) : ids;
}

// ——— Notation ———

export interface Grade { correct: boolean; score: number; missed: string[]; wrong: string[] }

export function gradeAnswer(q: Question, selected: readonly string[], rule: ScoringRule = "all_or_nothing"): Grade {
  const good = new Set(q.correct_option_ids);
  const sel = new Set(selected.filter((s) => q.options.some((o) => o.id === s)));
  const tp = [...sel].filter((s) => good.has(s)).length;
  const wrong = [...sel].filter((s) => !good.has(s));
  const missed = [...good].filter((g) => !sel.has(g));
  const correct = wrong.length === 0 && missed.length === 0;
  let score: number;
  if (q.type !== "multiple_choice" || rule === "all_or_nothing") score = correct ? 1 : 0;
  else if (rule === "partial") score = wrong.length ? 0 : tp / good.size;
  else score = Math.max(0, (tp - wrong.length) / good.size);
  return { correct, score: Math.round(score * 1000) / 1000, missed, wrong };
}

export function scoreOn20(scores: readonly number[], total = scores.length): number {
  if (!total) return 0;
  const sum = scores.reduce((a, b) => a + b, 0);
  return Math.round((sum / total) * 20 * 100) / 100;
}

// ——— Sélection des questions ———

export function isPlayable(q: Question): boolean {
  return q.review_status === "validated";
}

export function partOfModule(moduleId: string): string {
  return moduleId.split("-")[0];
}

export interface BuildOptions {
  rng?: () => number;
  /** Questions à poser en priorité (ex. erreurs), dans l'ordre donné. */
  preferredIds?: string[];
  /** Restreint strictement à ces questions. */
  onlyIds?: string[];
}

export function seenQuestionIds(attempts: readonly Attempt[]): Set<string> {
  return new Set(attempts.map((a) => a.question_id));
}

/**
 * Construit la liste des questions d'une session :
 * filtre (statut validé, parties, modules, difficulté, nouveauté), évite deux reformulations
 * d'un même groupe dans la session, priorise les questions jamais vues en mode découverte.
 */
export function buildSession(content: ContentState, attempts: readonly Attempt[], cfg: SessionConfig, opts: BuildOptions = {}): string[] {
  const rng = opts.rng ?? Math.random;
  const seen = seenQuestionIds(attempts);
  let pool = [...content.questions.values()].filter(isPlayable);
  if (opts.onlyIds) {
    const only = new Set(opts.onlyIds);
    pool = pool.filter((q) => only.has(q.id));
  }
  if (cfg.part_ids.length) pool = pool.filter((q) => cfg.part_ids.includes(partOfModule(q.module_id)));
  if (cfg.module_ids.length) pool = pool.filter((q) => cfg.module_ids.includes(q.module_id));
  if (cfg.difficulties.length) pool = pool.filter((q) => cfg.difficulties.includes(q.difficulty));
  if (cfg.novelty === "new") pool = pool.filter((q) => !seen.has(q.id));
  if (cfg.novelty === "seen") pool = pool.filter((q) => seen.has(q.id));

  let ordered = cfg.shuffle_questions ? shuffle(pool, rng) : [...pool].sort((a, b) => a.id.localeCompare(b.id));
  if (cfg.mode === "discovery") {
    // jamais vues d'abord, en conservant l'ordre du cours (identifiants) pour apprendre progressivement
    const fresh = ordered.filter((q) => !seen.has(q.id)).sort((a, b) => a.id.localeCompare(b.id));
    const old = ordered.filter((q) => seen.has(q.id));
    ordered = [...fresh, ...old];
  }
  if (opts.preferredIds?.length) {
    const pref = new Map(opts.preferredIds.map((id, i) => [id, i]));
    ordered = [
      ...ordered.filter((q) => pref.has(q.id)).sort((a, b) => pref.get(a.id)! - pref.get(b.id)!),
      ...ordered.filter((q) => !pref.has(q.id)),
    ];
  }

  const groups = new Set<string>();
  const out: string[] = [];
  for (const q of ordered) {
    if (out.length >= cfg.count) break;
    if (q.variant_group) {
      if (groups.has(q.variant_group)) continue;
      groups.add(q.variant_group);
    }
    out.push(q.id);
  }
  return out;
}

/** Nombre de questions jouables correspondant à une configuration (sans limite de nombre). */
export function countAvailable(content: ContentState, attempts: readonly Attempt[], cfg: SessionConfig): number {
  return buildSession(content, attempts, { ...cfg, count: Number.MAX_SAFE_INTEGER, shuffle_questions: false }).length;
}
