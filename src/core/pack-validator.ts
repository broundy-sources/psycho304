// Validation complète d'un paquet : schéma JSON + contrôles de cohérence.
// Mêmes règles que contenu-format/valider_paquet.py, avec en plus la prise en compte
// des contenus déjà présents dans l'application.

import schema from "../../contenu-format/psycho304-content.schema.json";
import { SchemaValidator } from "./schema-validator";
import type { ContentPack, ContentState, Course, Question } from "./types";
import { emptyContent } from "./types";

export interface Issue { level: "error" | "warning"; where: string; message: string }
export interface ValidationResult { ok: boolean; pack?: ContentPack; issues: Issue[] }

const validator = new SchemaValidator(schema as any);

const modPrefix = (id: string | undefined) => (id ?? "").match(/^(P[0-9]-M[0-9]{2})/)?.[1];

export function parsePackText(text: string): { data?: unknown; error?: string } {
  try {
    return { data: JSON.parse(text.replace(/^﻿/, "")) };
  } catch (e) {
    return { error: `JSON illisible : ${(e as Error).message}` };
  }
}

export function validatePack(data: unknown, existing: ContentState = emptyContent()): ValidationResult {
  const issues: Issue[] = [];
  const err = (where: string, message: string) => issues.push({ level: "error", where, message });
  const warn = (where: string, message: string) => issues.push({ level: "warning", where, message });

  if (!data || typeof data !== "object" || (data as any).format !== "psycho304-content") {
    err("fichier", "ce fichier n'est pas un paquet Psycho 304 (champ \"format\" absent ou incorrect)");
    return { ok: false, issues };
  }
  for (const e of validator.validate(data)) err(e.path, e.message);
  if (issues.length) return { ok: false, issues };

  const pack = data as ContentPack;
  const kind = pack.pack.kind;
  if (kind === "example") err("pack.kind", "fichier d'exemple du format : il n'est pas importable (utiliser kind \"content\")");

  // Doublons et espaces de noms
  const idsIn = (arr?: { id: string }[]) => {
    const seen = new Set<string>();
    for (const it of arr ?? []) {
      if (seen.has(it.id)) err(it.id, "identifiant dupliqué dans le paquet");
      seen.add(it.id);
      if (kind === "demo" && !it.id.startsWith("P0"))
        err(it.id, "paquet de démonstration : les identifiants doivent utiliser la partie P0");
      if (kind === "content" && /^P0(-|$)/.test(it.id)) err(it.id, "P0 est réservé aux données de démonstration");
    }
    return seen;
  };
  idsIn(pack.parts);
  idsIn(pack.modules);
  idsIn(pack.concepts);
  idsIn(pack.courses);
  idsIn(pack.questions);
  const srcSeen = new Set<string>();
  for (const s of pack.sources ?? []) {
    if (srcSeen.has(s.id)) err(s.id, "identifiant de source dupliqué dans le paquet");
    srcSeen.add(s.id);
  }

  const has = (coll: keyof ContentState, id: string) =>
    existing[coll].has(id) || ((pack as any)[coll] ?? []).some((x: { id: string }) => x.id === id);

  // Sous-parties de cours (paquet + existant)
  const sections = new Set<string>();
  for (const c of existing.courses.values()) for (const s of c.sections) sections.add(s.id);
  const packSections = new Set<string>();
  for (const c of pack.courses ?? []) checkCourse(c);
  function checkCourse(c: Course) {
    if (modPrefix(c.id) !== c.module_id) err(c.id, `le préfixe ne correspond pas à module_id ${c.module_id}`);
    if (!has("modules", c.module_id)) err(c.id, `module ${c.module_id} inconnu`);
    for (const s of c.sections) {
      if (packSections.has(s.id)) err(s.id, "sous-partie dupliquée");
      packSections.add(s.id);
      sections.add(s.id);
      if (modPrefix(s.id) !== c.module_id) err(s.id, `préfixe différent du module du cours (${c.module_id})`);
      for (const cid of s.concept_ids) if (!has("concepts", cid)) err(s.id, `notion ${cid} inconnue`);
      for (const b of s.blocks) {
        if (b.type === "table")
          b.rows.forEach((r, i) => {
            if (r.length !== b.columns.length) err(s.id, `tableau : la ligne ${i + 1} a ${r.length} cellule(s) au lieu de ${b.columns.length}`);
          });
        if (b.type === "definition" && b.concept_id && !has("concepts", b.concept_id)) warn(s.id, `définition liée à une notion inconnue (${b.concept_id})`);
      }
      for (const r of s.sources ?? []) if (!has("sources", r.source_id)) warn(s.id, `source ${r.source_id} inconnue`);
    }
  }

  for (const m of pack.modules ?? []) {
    if (!m.id.startsWith(m.part_id + "-")) err(m.id, `préfixe incohérent avec part_id ${m.part_id}`);
    if (Number(m.id.slice(-2)) !== m.number) err(m.id, `number ${m.number} ne correspond pas à l'identifiant`);
    if (!has("parts", m.part_id)) err(m.id, `partie ${m.part_id} inconnue`);
    for (const sid of m.source_ids ?? []) if (!has("sources", sid)) warn(m.id, `source ${sid} inconnue`);
  }

  for (const c of pack.concepts ?? []) {
    if (modPrefix(c.id) !== c.module_id) err(c.id, `préfixe incohérent avec module_id ${c.module_id}`);
    if (!has("modules", c.module_id)) err(c.id, `module ${c.module_id} inconnu`);
    for (const r of c.sources) if (!has("sources", r.source_id)) warn(c.id, `source ${r.source_id} inconnue`);
    for (const o of [...(c.confusable_with ?? []), ...(c.prerequisites ?? [])]) {
      if (o === c.id) err(c.id, "la notion se référence elle-même");
      else if (!has("concepts", o)) warn(c.id, `notion liée ${o} inconnue`);
    }
  }

  const conceptsWithQuestions = new Set<string>();
  for (const q of existing.questions.values()) q.concept_ids.forEach((c) => conceptsWithQuestions.add(c));
  for (const q of pack.questions ?? []) checkQuestion(q);
  function checkQuestion(q: Question) {
    if (modPrefix(q.id) !== q.module_id) err(q.id, `préfixe incohérent avec module_id ${q.module_id}`);
    if (!has("modules", q.module_id)) err(q.id, `module ${q.module_id} inconnu`);
    const optIds = q.options.map((o) => o.id);
    if (new Set(optIds).size !== optIds.length) err(q.id, "identifiants de propositions dupliqués");
    const texts = q.options.map((o) => o.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) err(q.id, "deux propositions ont le même texte");
    for (const c of q.correct_option_ids) if (!optIds.includes(c)) err(q.id, `bonne réponse « ${c} » absente des propositions`);
    if (q.type === "single_choice" && q.correct_option_ids.length !== 1) err(q.id, "single_choice exige exactement une bonne réponse");
    if (q.type === "multiple_choice" && q.correct_option_ids.length === optIds.length) warn(q.id, "toutes les propositions sont justes — à vérifier");
    if (q.type !== "true_false" && optIds.join() !== [...optIds].sort().join()) warn(q.id, "propositions non ordonnées (a, b, c…)");
    const expl = Object.keys(q.option_explanations);
    const missing = optIds.filter((o) => !expl.includes(o));
    const extra = expl.filter((o) => !optIds.includes(o));
    if (missing.length) err(q.id, `justification manquante pour : ${missing.join(", ")}`);
    if (extra.length) err(q.id, `justification pour des propositions inexistantes : ${extra.join(", ")}`);
    for (const o of q.options) {
      if (!o.confusion_concept_id) continue;
      if (q.correct_option_ids.includes(o.id)) err(q.id, `confusion_concept_id sur une bonne réponse (${o.id})`);
      if (!has("concepts", o.confusion_concept_id)) warn(q.id, `notion de confusion ${o.confusion_concept_id} inconnue`);
    }
    for (const cid of q.concept_ids) {
      conceptsWithQuestions.add(cid);
      if (!has("concepts", cid)) err(q.id, `notion ${cid} inconnue`);
      const c = (pack.concepts ?? []).find((x) => x.id === cid) ?? existing.concepts.get(cid);
      if (c && q.review_status === "validated" && c.verification_status !== "verified")
        warn(q.id, `validée alors que la notion ${cid} n'est pas vérifiée`);
    }
    for (const r of q.sources) if (!has("sources", r.source_id)) warn(q.id, `source ${r.source_id} inconnue`);
    for (const sid of q.course_section_ids ?? []) if (!sections.has(sid)) warn(q.id, `sous-partie ${sid} inconnue`);
    if (q.version > 1 && !q.revision_note) warn(q.id, "version > 1 sans revision_note");
  }

  for (const c of pack.concepts ?? [])
    if (c.assessment !== "not_evaluated" && !conceptsWithQuestions.has(c.id)) warn(c.id, "aucune question associée");

  return { ok: !issues.some((i) => i.level === "error"), pack, issues };
}
