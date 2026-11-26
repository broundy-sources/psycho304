// Indicateurs calculés en rejouant le journal des réponses. Fonctions pures.
// Lot 1 : notions rencontrées, réussite, erreurs, temps. Le lot 2 ajoutera ici
// les niveaux de maîtrise et la répétition espacée (même principe de rejeu).

import type { Attempt, ContentState, SessionRecord } from "./types";
import { isPlayable, partOfModule } from "./qcm";

export interface QuestionStat { attempts: number; correct: number; firstCorrect: boolean; lastCorrect: boolean; lastAt: string; lastSelected: string[] }
export interface ConceptStat { attempts: number; correct: number; errors: number; lastAt?: string }
export interface Coverage { total: number; encountered: number; pct: number }

export function sortAttempts(attempts: readonly Attempt[]): Attempt[] {
  return [...attempts].sort((a, b) => a.answered_at.localeCompare(b.answered_at) || a.id.localeCompare(b.id));
}

export function questionStats(attempts: readonly Attempt[]): Map<string, QuestionStat> {
  const m = new Map<string, QuestionStat>();
  for (const a of sortAttempts(attempts)) {
    const s = m.get(a.question_id);
    if (!s) {
      m.set(a.question_id, { attempts: 1, correct: a.correct ? 1 : 0, firstCorrect: a.correct, lastCorrect: a.correct, lastAt: a.answered_at, lastSelected: a.selected_option_ids });
    } else {
      s.attempts++;
      if (a.correct) s.correct++;
      s.lastCorrect = a.correct;
      s.lastAt = a.answered_at;
      s.lastSelected = a.selected_option_ids;
    }
  }
  return m;
}

export function conceptStats(attempts: readonly Attempt[]): Map<string, ConceptStat> {
  const m = new Map<string, ConceptStat>();
  for (const a of attempts) {
    for (const c of a.concept_ids) {
      const s = m.get(c) ?? { attempts: 0, correct: 0, errors: 0 };
      s.attempts++;
      if (a.correct) s.correct++;
      else s.errors++;
      if (!s.lastAt || a.answered_at > s.lastAt) s.lastAt = a.answered_at;
      m.set(c, s);
    }
  }
  return m;
}

/** Notions comptées dans la progression : toutes sauf celles explicitement non évaluées. */
export function trackedConcepts(content: ContentState, filter?: (moduleId: string) => boolean) {
  return [...content.concepts.values()].filter((c) => c.assessment !== "not_evaluated" && (!filter || filter(c.module_id)));
}

export function coverage(content: ContentState, cstats: Map<string, ConceptStat>, filter?: (moduleId: string) => boolean): Coverage {
  const list = trackedConcepts(content, filter);
  const encountered = list.filter((c) => (cstats.get(c.id)?.attempts ?? 0) > 0).length;
  return { total: list.length, encountered, pct: list.length ? Math.round((encountered / list.length) * 100) : 0 };
}

export function daysUntil(dateIso: string | null, now = new Date()): number | null {
  if (!dateIso) return null;
  const [y, m, d] = dateIso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

export interface Dashboard {
  answered: number;
  errors: number;
  questionsSeen: number;
  firstTryRate: number | null; // % de questions réussies dès la première rencontre
  successRate: number | null;
  timeMs: number;
  overall: Coverage;
  parts: { id: string; title: string; cov: Coverage; questions: number }[];
  modules: { id: string; part_id: string; title: string; number: number; cov: Coverage; questions: number; successRate: number | null; status?: string }[];
  weakest: { id: string; title: string; module_id: string; errors: number; attempts: number; rate: number }[];
  recentSessions: SessionRecord[];
  playableQuestions: number;
}

export function computeDashboard(content: ContentState, attempts: readonly Attempt[], sessions: readonly SessionRecord[]): Dashboard {
  const qs = questionStats(attempts);
  const cs = conceptStats(attempts);
  const answered = attempts.length;
  const correct = attempts.filter((a) => a.correct).length;
  const firsts = [...qs.values()];
  const playable = [...content.questions.values()].filter(isPlayable);

  const moduleQ = new Map<string, number>();
  for (const q of playable) moduleQ.set(q.module_id, (moduleQ.get(q.module_id) ?? 0) + 1);
  const moduleAtt = new Map<string, { n: number; ok: number }>();
  for (const a of attempts) {
    const s = moduleAtt.get(a.module_id) ?? { n: 0, ok: 0 };
    s.n++;
    if (a.correct) s.ok++;
    moduleAtt.set(a.module_id, s);
  }

  const parts = [...content.parts.values()]
    .sort((a, b) => a.order - b.order)
    .map((p) => ({
      id: p.id,
      title: p.title,
      cov: coverage(content, cs, (m) => partOfModule(m) === p.id),
      questions: playable.filter((q) => partOfModule(q.module_id) === p.id).length,
    }));

  const modules = [...content.modules.values()]
    .sort((a, b) => a.number - b.number)
    .map((m) => {
      const att = moduleAtt.get(m.id);
      return {
        id: m.id,
        part_id: m.part_id,
        title: m.title,
        number: m.number,
        status: m.status,
        cov: coverage(content, cs, (x) => x === m.id),
        questions: moduleQ.get(m.id) ?? 0,
        successRate: att?.n ? Math.round((att.ok / att.n) * 100) : null,
      };
    });

  const weakest = [...cs.entries()]
    .filter(([, s]) => s.errors > 0)
    .map(([id, s]) => {
      const c = content.concepts.get(id);
      return { id, title: c?.title ?? id, module_id: c?.module_id ?? "", errors: s.errors, attempts: s.attempts, rate: Math.round((s.correct / s.attempts) * 100) };
    })
    .sort((a, b) => a.rate - b.rate || b.errors - a.errors)
    .slice(0, 6);

  return {
    answered,
    errors: answered - correct,
    questionsSeen: qs.size,
    firstTryRate: firsts.length ? Math.round((firsts.filter((f) => f.firstCorrect).length / firsts.length) * 100) : null,
    successRate: answered ? Math.round((correct / answered) * 100) : null,
    timeMs: attempts.reduce((a, b) => a + b.duration_ms, 0),
    overall: coverage(content, cs),
    parts,
    modules,
    weakest,
    recentSessions: [...sessions].filter((s) => s.ended_at).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 5),
    playableQuestions: playable.length,
  };
}

/** Questions dont la dernière réponse est fausse (mode erreurs simplifié du lot 1). */
export function currentErrors(attempts: readonly Attempt[]): { question_id: string; count: number; lastAt: string; lastSelected: string[] }[] {
  const qs = questionStats(attempts);
  const out: { question_id: string; count: number; lastAt: string; lastSelected: string[] }[] = [];
  for (const [id, s] of qs) if (!s.lastCorrect) out.push({ question_id: id, count: s.attempts - s.correct, lastAt: s.lastAt, lastSelected: s.lastSelected });
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}
