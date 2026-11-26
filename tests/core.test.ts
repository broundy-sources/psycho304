// Tests du noyau métier. Données exclusivement fictives (partie P0 / fichier d'exemple).
import { describe, expect, test } from "bun:test";
import demo from "../public/demo/paquet-demo.json";
import example from "../contenu-format/exemple-paquet.json";
import { validatePack, parsePackText } from "../src/core/pack-validator";
import { planImport, applyPlan } from "../src/core/importer";
import { gradeAnswer, displayOrder, buildSession, scoreOn20, mulberry32, countAvailable } from "../src/core/qcm";
import { computeDashboard, currentErrors, daysUntil } from "../src/core/progress";
import { emptyContent, type Attempt, type ContentPack, type Question, type SessionConfig } from "../src/core/types";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const errorsOf = (r: ReturnType<typeof validatePack>) => r.issues.filter((i) => i.level === "error");

function loaded() {
  const v = validatePack(clone(demo));
  expect(v.ok).toBe(true);
  return applyPlan(emptyContent(), planImport(emptyContent(), v.pack!));
}

const cfg = (over: Partial<SessionConfig> = {}): SessionConfig => ({
  mode: "free", part_ids: [], module_ids: [], difficulties: [], count: 50, novelty: "all", shuffle_questions: true, shuffle_options: true, ...over,
});

let n = 0;
function attempt(q: Question, correct: boolean, at = "2026-11-20T10:00:00Z", selected?: string[]): Attempt {
  n++;
  return {
    id: `t-${n}`, session_id: "s1", question_id: q.id, question_version: q.version, concept_ids: q.concept_ids, module_id: q.module_id,
    selected_option_ids: selected ?? (correct ? q.correct_option_ids : ["zz"]), displayed_option_ids: q.options.map((o) => o.id),
    correct, score: correct ? 1 : 0, confidence: "sure", duration_ms: 10_000, answered_at: at, mode: "free", first_seen: false, device_id: "test",
  };
}

describe("validation des paquets", () => {
  test("le paquet de démonstration est valide", () => {
    const r = validatePack(clone(demo));
    expect(errorsOf(r)).toEqual([]);
  });

  test("le fichier d'exemple respecte le schéma mais est refusé à l'import", () => {
    const r = validatePack(clone(example));
    const errs = errorsOf(r);
    expect(errs.length).toBe(1);
    expect(errs[0].where).toBe("pack.kind");
  });

  test("JSON illisible", () => {
    expect(parsePackText("{ pas du json").error).toContain("JSON illisible");
    expect(parsePackText("﻿{\"a\":1}").data).toEqual({ a: 1 });
  });

  test("fichier qui n'est pas un paquet", () => {
    expect(validatePack({ hello: 1 }).ok).toBe(false);
    expect(validatePack(null).ok).toBe(false);
  });

  test("champ inconnu, champ manquant, type erroné", () => {
    const d = clone(demo) as any;
    d.questions[0].enonce = "faute de frappe";
    delete d.questions[1].explanation;
    d.questions[2].version = "1";
    const msgs = errorsOf(validatePack(d)).map((e) => `${e.where} ${e.message}`);
    expect(msgs.some((m) => m.includes("questions/0") && m.includes("enonce"))).toBe(true);
    expect(msgs.some((m) => m.includes("questions/1") && m.includes("explanation"))).toBe(true);
    expect(msgs.some((m) => m.includes("questions/2/version"))).toBe(true);
  });

  test("détection des identifiants dupliqués", () => {
    const d = clone(demo) as any;
    d.questions.push(clone(d.questions[0]));
    d.concepts.push(clone(d.concepts[0]));
    const errs = errorsOf(validatePack(d));
    expect(errs.filter((e) => e.message.includes("dupliqué")).length).toBe(2);
  });

  test("incohérences de question : bonne réponse absente, justification manquante, single_choice à 2 réponses", () => {
    const d = clone(demo) as any;
    d.questions[0].correct_option_ids = ["h"];
    delete d.questions[1].option_explanations.d;
    const errs = errorsOf(validatePack(d)).map((e) => e.message).join("\n");
    expect(errs).toContain("« h »");
    expect(errs).toContain("justification manquante");
    const d2 = clone(demo) as any;
    d2.questions[5].correct_option_ids = ["a", "b"];
    expect(errorsOf(validatePack(d2)).map((e) => e.message).join()).toMatch(/au plus 1/);
  });

  test("vrai/faux : identifiants imposés et ordre fixe", () => {
    const d = clone(demo) as any;
    d.questions[3].shuffle_options = true;
    expect(validatePack(d).ok).toBe(false);
  });

  test("bloc de cours mal formé : message ciblé sur la variante", () => {
    const d = clone(demo) as any;
    d.courses[0].sections[0].blocks[2] = { type: "definition", term: "X" };
    const errs = errorsOf(validatePack(d));
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("« definition »");
    const d2 = clone(demo) as any;
    d2.courses[0].sections[0].blocks[3].rows[0] = ["un", "deux"];
    expect(errorsOf(validatePack(d2))[0].message).toContain("cellule");
  });

  test("références inconnues : erreur pour une notion, avertissement pour une source", () => {
    const d = clone(demo) as any;
    d.questions[0].concept_ids = ["P0-M01-C999"];
    d.questions[1].sources = [{ source_id: "P0-INCONNU", location: "p. 1" }];
    const r = validatePack(d);
    expect(errorsOf(r).some((e) => e.message.includes("P0-M01-C999"))).toBe(true);
    expect(r.issues.some((e) => e.level === "warning" && e.message.includes("P0-INCONNU"))).toBe(true);
  });

  test("références résolues par les contenus déjà installés", () => {
    const state = loaded();
    const only: ContentPack = { format: "psycho304-content", format_version: "1.0.0", pack: { ...demo.pack, id: "q-seules", kind: "demo" } as any, questions: [clone(demo.questions[0]) as any] };
    expect(validatePack(only, state).ok).toBe(true);
    expect(validatePack(only).ok).toBe(false);
  });

  test("espaces de noms : P0 interdit dans un paquet réel", () => {
    const d = clone(demo) as any;
    d.pack.kind = "content";
    expect(errorsOf(validatePack(d)).some((e) => e.message.includes("P0"))).toBe(true);
  });
});

describe("import et fusion", () => {
  test("import initial puis réimport identique : aucun changement", () => {
    const s1 = loaded();
    expect(s1.questions.size).toBe(demo.questions.length);
    const plan = planImport(s1, validatePack(clone(demo)).pack!);
    expect(plan.writes.length).toBe(0);
    expect(plan.counts.questions.unchanged).toBe(demo.questions.length);
  });

  test("nouvelle version : mise à jour, archivage, signalement à revérifier", () => {
    const s1 = loaded();
    const d = clone(demo) as any;
    d.pack.version = 2;
    d.questions[0].version = 2;
    d.questions[0].correct_option_ids = ["b"];
    d.questions[0].options[1] = { id: "b", text: "Jupiter" };
    d.questions[0].revision_note = "test";
    d.questions[2].version = 2;
    d.questions[2].explanation = "Explication reformulée";
    d.questions[2].revision_note = "test";
    const plan = planImport(s1, validatePack(d).pack!);
    expect(plan.counts.questions.updated).toBe(2);
    expect(plan.history.map((h) => h.id).sort()).toEqual(["P0-M01-Q001", "P0-M01-Q003"]);
    const s2 = applyPlan(s1, plan);
    expect(s2.questions.get("P0-M01-Q001")!._needs_recheck).toBe(true);
    expect(s2.questions.get("P0-M01-Q003")!._needs_recheck).toBeUndefined();
    expect(s2.questions.size).toBe(s1.questions.size);
  });

  test("même version au contenu différent, ou version plus ancienne : ignoré avec avertissement", () => {
    const s1 = loaded();
    const d = clone(demo) as any;
    d.questions[0].explanation = "modifiée sans version";
    const plan = planImport(s1, d);
    expect(plan.counts.questions.skipped).toBe(1);
    expect(plan.warnings[0]).toContain("incrémenter");
  });

  test("un paquet partiel ne supprime rien", () => {
    const s1 = loaded();
    const partial = { format: "psycho304-content", format_version: "1.0.0", pack: { ...demo.pack, id: "partiel" }, questions: [] } as any;
    const s2 = applyPlan(s1, planImport(s1, partial));
    expect(s2.questions.size).toBe(s1.questions.size);
    expect(s2.concepts.size).toBe(s1.concepts.size);
  });

  test("l'import préserve la progression (calculée à partir du journal, rattachée aux identifiants)", () => {
    const s1 = loaded();
    const q = s1.questions.get("P0-M01-Q001")!;
    const log = [attempt(q, true)];
    const before = computeDashboard(s1, log, []);
    const d = clone(demo) as any;
    d.questions.push({ ...clone(d.questions[7]), id: "P0-M02-Q003", question: "Nouvelle question" });
    d.questions[d.questions.length - 1].options[0].text = "Atlantique bis";
    const s2 = applyPlan(s1, planImport(s1, validatePack(d).pack!));
    const after = computeDashboard(s2, log, []);
    expect(after.answered).toBe(before.answered);
    expect(after.overall.encountered).toBe(before.overall.encountered);
    expect(after.playableQuestions).toBe(before.playableQuestions + 1);
  });
});

describe("moteur de QCM", () => {
  const s = loaded();
  const single = s.questions.get("P0-M01-Q001")!;
  const multi = s.questions.get("P0-M01-Q003")!; // a, b, d
  const tf = s.questions.get("P0-M01-Q004")!;

  test("réponse unique", () => {
    expect(gradeAnswer(single, ["a"]).correct).toBe(true);
    expect(gradeAnswer(single, ["b"])).toMatchObject({ correct: false, score: 0, wrong: ["b"], missed: ["a"] });
    expect(gradeAnswer(single, []).correct).toBe(false);
  });

  test("vrai / faux", () => {
    expect(gradeAnswer(tf, ["vrai"]).correct).toBe(true);
    expect(gradeAnswer(tf, ["faux"]).correct).toBe(false);
  });

  test("réponses multiples : tout ou rien", () => {
    expect(gradeAnswer(multi, ["a", "b", "d"]).score).toBe(1);
    expect(gradeAnswer(multi, ["d", "a", "b"]).correct).toBe(true);
    expect(gradeAnswer(multi, ["a", "b"]).score).toBe(0);
    expect(gradeAnswer(multi, ["a", "b", "d", "c"]).score).toBe(0);
  });

  test("réponses multiples : barèmes partiels", () => {
    expect(gradeAnswer(multi, ["a", "b"], "partial").score).toBeCloseTo(0.667, 3);
    expect(gradeAnswer(multi, ["a", "b", "c"], "partial").score).toBe(0);
    expect(gradeAnswer(multi, ["a", "b", "c"], "partial_with_penalty").score).toBeCloseTo(0.333, 3);
    expect(gradeAnswer(multi, ["c", "e"], "partial_with_penalty").score).toBe(0);
    expect(gradeAnswer(multi, ["a", "b"], "partial").correct).toBe(false);
  });

  test("le mélange des propositions n'altère jamais la correction", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const order = displayOrder(multi, true, rng);
      expect([...order].sort()).toEqual(multi.options.map((o) => o.id).sort());
      // l'étudiant coche les propositions justes, quelle que soit leur position affichée
      const picked = order.filter((id) => multi.correct_option_ids.includes(id));
      expect(gradeAnswer(multi, picked).correct).toBe(true);
    }
    const orders = new Set(Array.from({ length: 50 }, () => displayOrder(multi, true, rng).join("")));
    expect(orders.size).toBeGreaterThan(5);
  });

  test("ordre fixe respecté (vrai/faux, shuffle_options false)", () => {
    const fixed = s.questions.get("P0-M01-Q005")!;
    for (let i = 0; i < 20; i++) {
      expect(displayOrder(tf, true)).toEqual(["vrai", "faux"]);
      expect(displayOrder(fixed, true)).toEqual(["a", "b", "c", "d"]);
    }
  });

  test("note sur 20", () => {
    expect(scoreOn20([1, 1, 0, 0.5])).toBe(12.5);
    expect(scoreOn20([])).toBe(0);
    expect(scoreOn20([1, 1], 4)).toBe(10);
  });

  test("questions non validées exclues des sessions", () => {
    const ids = buildSession(s, [], cfg({ count: 100 }));
    expect(ids).not.toContain("P0-M01-Q007");
  });

  test("filtres : module, difficulté, nouveauté, nombre", () => {
    expect(buildSession(s, [], cfg({ module_ids: ["P0-M02"] })).every((id) => id.startsWith("P0-M02"))).toBe(true);
    expect(buildSession(s, [], cfg({ difficulties: ["advanced"] }))).toEqual(["P0-M01-Q006"]);
    expect(buildSession(s, [], cfg({ count: 2 })).length).toBe(2);
    const log = [attempt(s.questions.get("P0-M02-Q001")!, true)];
    expect(buildSession(s, log, cfg({ novelty: "new" }))).not.toContain("P0-M02-Q001");
    expect(buildSession(s, log, cfg({ novelty: "seen" }))).toEqual(["P0-M02-Q001"]);
  });

  test("deux reformulations d'un même groupe jamais dans la même session", () => {
    for (let i = 0; i < 30; i++) {
      const ids = buildSession(s, [], cfg(), { rng: mulberry32(i) });
      expect(ids.filter((id) => id === "P0-M01-Q001" || id === "P0-M01-Q002").length).toBe(1);
    }
    expect(countAvailable(s, [], cfg())).toBe(7); // 8 validées, dont 2 du même groupe
  });

  test("mode découverte : questions jamais vues en premier", () => {
    const log = [attempt(s.questions.get("P0-M01-Q003")!, true)];
    const ids = buildSession(s, log, cfg({ mode: "discovery" }));
    expect(ids[ids.length - 1]).toBe("P0-M01-Q003");
  });
});

describe("progression", () => {
  const s = loaded();
  const q1 = s.questions.get("P0-M01-Q001")!;
  const q3 = s.questions.get("P0-M01-Q003")!;
  const q8 = s.questions.get("P0-M02-Q001")!;

  test("indicateurs du tableau de bord", () => {
    const log = [attempt(q1, false, "2026-11-20T10:00:00Z"), attempt(q1, true, "2026-11-21T10:00:00Z"), attempt(q3, true, "2026-11-21T10:01:00Z"), attempt(q8, true, "2026-11-21T10:02:00Z")];
    const d = computeDashboard(s, log, []);
    expect(d.answered).toBe(4);
    expect(d.errors).toBe(1);
    expect(d.questionsSeen).toBe(3);
    expect(d.firstTryRate).toBe(67);
    expect(d.timeMs).toBe(40_000);
    // notions suivies : 5 (toutes évaluées ou à confirmer) ; rencontrées : C001, C002, M02-C001
    expect(d.overall).toEqual({ total: 5, encountered: 3, pct: 60 });
    expect(d.modules.find((m) => m.id === "P0-M01")!.cov.encountered).toBe(2);
    expect(d.weakest[0].id).toBe("P0-M01-C001");
  });

  test("questions réussies ≠ progression : répondre plusieurs fois à la même question n'augmente pas la couverture", () => {
    const log = Array.from({ length: 10 }, (_, i) => attempt(q8, true, `2026-11-2${i % 9}T10:00:00Z`));
    expect(computeDashboard(s, log, []).overall.encountered).toBe(1);
  });

  test("erreurs en cours : disparaissent quand la question est réussie ensuite", () => {
    const log = [attempt(q1, false, "2026-11-20T10:00:00Z", ["b"]), attempt(q3, false, "2026-11-20T10:01:00Z")];
    expect(currentErrors(log).map((e) => e.question_id).sort()).toEqual(["P0-M01-Q001", "P0-M01-Q003"]);
    log.push(attempt(q1, true, "2026-11-21T10:00:00Z"));
    expect(currentErrors(log).map((e) => e.question_id)).toEqual(["P0-M01-Q003"]);
  });

  test("compte à rebours de l'examen", () => {
    expect(daysUntil("2026-12-20", new Date(2026, 10, 26, 23, 0))).toBe(24);
    expect(daysUntil(null)).toBeNull();
  });
});

import { makeBackup, mergeBackup, isBackup, type Snapshot } from "../src/core/backup";

describe("sauvegarde et restauration", () => {
  const s = loaded();
  const q = s.questions.get("P0-M01-Q001")!;
  const snap = (attempts: Attempt[], content = s): Snapshot => ({
    content: Object.fromEntries((["sources", "parts", "modules", "concepts", "courses", "questions"] as const).map((c) => [c, [...(content[c] as Map<string, any>).values()]])) as any,
    history: [], packs: [], attempts, sessions: [], settings: [{ key: "theme", value: "dark", updated_at: "2026-11-01T00:00:00Z" }],
  });

  test("export complet reconnaissable", () => {
    const b = makeBackup(snap([attempt(q, true)]), "test", "dev1");
    expect(isBackup(JSON.parse(JSON.stringify(b)))).toBe(true);
    expect(b.attempts.length).toBe(1);
  });

  test("restauration sur appareil vierge puis fusion sans doublon ni perte", () => {
    const a1 = attempt(q, true), a2 = attempt(q, false), a3 = attempt(q, true);
    const backup = makeBackup(snap([a1, a2]), "test", "dev1");
    const empty: Snapshot = { content: { sources: [], parts: [], modules: [], concepts: [], courses: [], questions: [] }, history: [], packs: [], attempts: [], sessions: [], settings: [] };
    const r1 = mergeBackup(empty, backup);
    expect(r1.summary.attempts).toBe(2);
    expect(r1.summary.content).toBe(demo.questions.length + demo.concepts.length + demo.modules.length + demo.parts.length + demo.sources.length + demo.courses.length);
    // appareil qui possède déjà a1 et une réponse propre a3 : seule a2 est ajoutée, a3 n'est pas touchée
    const r2 = mergeBackup(snap([a1, a3]), backup);
    expect(r2.summary.attempts).toBe(1);
    expect(r2.ops.filter((o) => o.store === "attempts").map((o: any) => o.put.id)).toEqual([a2.id]);
    // réglage plus récent localement : conservé
    const local = snap([]);
    local.settings = [{ key: "theme", value: "light", updated_at: "2026-11-20T00:00:00Z" }];
    expect(mergeBackup(local, backup).summary.settings).toBe(0);
  });

  test("une sauvegarde ancienne ne remplace pas une version plus récente d'une question", () => {
    const newer = new Map(s.questions);
    newer.set(q.id, { ...q, version: 3, explanation: "v3" });
    const current = snap([], { ...s, questions: newer });
    const r = mergeBackup(current, makeBackup(snap([]), "t", "d"));
    expect(r.ops.some((o: any) => o.store === "questions" && o.put.id === q.id)).toBe(false);
  });
});
