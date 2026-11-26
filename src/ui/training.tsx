import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store";
import { Bar, CATEGORY_FR, Chip, DIFFICULTY_FR, Icon, MODE_FR, Modal, RichText, Seg, TYPE_HINT } from "./components";
import { SectionView, SourceLine, sectionsFor } from "./courses";
import { buildSession, countAvailable, displayOrder, gradeAnswer, partOfModule, type Grade } from "../core/qcm";
import { currentErrors, formatDuration } from "../core/progress";
import type { Confidence, Difficulty, SessionConfig, TrainingMode } from "../core/types";

const DEFAULT_CFG: SessionConfig = {
  mode: "discovery", part_ids: [], module_ids: [], difficulties: [], count: 20, novelty: "all", shuffle_questions: true, shuffle_options: true,
};

const MODES: { v: TrainingMode; title: string; desc: string; lot?: string }[] = [
  { v: "discovery", title: "Découverte", desc: "Questions jamais vues d'abord, correction immédiate. Pour apprendre le cours." },
  { v: "free", title: "Libre", desc: "Choisissez parties, modules, difficulté et nombre de questions." },
  { v: "errors", title: "Mes erreurs", desc: "Refaire les questions actuellement ratées." },
  { v: "review", title: "Révision du jour", desc: "Notions arrivées à échéance (répétition espacée).", lot: "Lot 2" },
  { v: "consolidation", title: "Consolidation", desc: "Notions rencontrées mais fragiles, formulations différentes.", lot: "Lot 2" },
];

export function TrainingPage() {
  const { data, startSession, toast } = useStore();
  const [cfg, setCfg] = useState<SessionConfig>(DEFAULT_CFG);
  const set = (p: Partial<SessionConfig>) => setCfg((c) => ({ ...c, ...p }));
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const parts = [...data.content.parts.values()].sort((a, b) => a.order - b.order);
  const modules = [...data.content.modules.values()].sort((a, b) => a.number - b.number);
  const errorIds = useMemo(() => currentErrors(data.attempts).map((e) => e.question_id), [data.attempts]);
  const effective = cfg.mode === "errors" ? { ...cfg, novelty: "all" as const } : cfg;
  const available = useMemo(() => {
    if (cfg.mode === "errors") return buildSession(data.content, data.attempts, { ...effective, count: Number.MAX_SAFE_INTEGER }, { onlyIds: errorIds }).length;
    return countAvailable(data.content, data.attempts, effective);
  }, [data, effective, errorIds, cfg.mode]);
  const n = Math.min(available, cfg.count);

  const start = () => {
    const ok = startSession(effective, cfg.mode === "errors" ? { onlyIds: errorIds, preferredIds: errorIds } : undefined);
    if (!ok) toast("Aucune question ne correspond à ces critères");
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>Entraînement</h1>
          <p>Choisissez un mode puis lancez la session.</p>
        </div>
      </div>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {MODES.map((m) => (
          <button
            key={m.v}
            type="button"
            className={`card option${cfg.mode === m.v ? " sel" : ""}`}
            style={{ display: "block", boxShadow: "none" }}
            disabled={!!m.lot}
            onClick={() => set({ mode: m.v })}
          >
            <div className="row-between"><strong>{m.title}</strong>{m.lot ? <span className="tag">{m.lot}</span> : m.v === "errors" ? <span className="tag tag-ko">{errorIds.length}</span> : null}</div>
            <div className="muted" style={{ fontSize: "0.88rem", marginTop: 4 }}>{m.desc}</div>
          </button>
        ))}
      </div>

      <div className="card stack">
        <div className="field">
          <span className="label">Parties</span>
          <div className="chips">
            <Chip on={!cfg.part_ids.length} onClick={() => set({ part_ids: [], module_ids: [] })}>Toutes</Chip>
            {parts.map((p) => (
              <Chip key={p.id} on={cfg.part_ids.includes(p.id)} onClick={() => set({ part_ids: toggle(cfg.part_ids, p.id), module_ids: [] })}>{p.id} · {p.title}</Chip>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Modules</span>
          <div className="chips">
            <Chip on={!cfg.module_ids.length} onClick={() => set({ module_ids: [] })}>Tous</Chip>
            {modules
              .filter((m) => !cfg.part_ids.length || cfg.part_ids.includes(m.part_id))
              .map((m) => (
                <Chip key={m.id} on={cfg.module_ids.includes(m.id)} onClick={() => set({ module_ids: toggle(cfg.module_ids, m.id) })}>
                  M{m.number} · {m.title}
                </Chip>
              ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Difficulté</span>
          <div className="chips">
            <Chip on={!cfg.difficulties.length} onClick={() => set({ difficulties: [] })}>Toutes</Chip>
            {(["basic", "intermediate", "advanced"] as Difficulty[]).map((d) => (
              <Chip key={d} on={cfg.difficulties.includes(d)} onClick={() => set({ difficulties: toggle(cfg.difficulties, d) })}>{DIFFICULTY_FR[d]}</Chip>
            ))}
          </div>
        </div>
        {cfg.mode === "free" && (
          <div className="field">
            <span className="label">Questions</span>
            <Seg value={cfg.novelty} onChange={(v) => set({ novelty: v })} options={[{ v: "all", label: "Toutes" }, { v: "new", label: "Nouvelles" }, { v: "seen", label: "Déjà rencontrées" }]} />
          </div>
        )}
        <div className="field">
          <span className="label">Nombre de questions</span>
          <Seg value={cfg.count} onChange={(v) => set({ count: v })} options={[10, 20, 30, 50].map((v) => ({ v, label: String(v) })).concat([{ v: 9999, label: "Toutes" }])} />
        </div>
        <div className="row-between" style={{ paddingTop: 8 }}>
          <span className="muted">{available ? `${n} question(s) sur ${available} disponible(s)` : "Aucune question disponible avec ces critères"}</span>
          <button className="btn btn-primary" disabled={!available} onClick={start}><Icon name="play" size={16} /> Commencer</button>
        </div>
      </div>
    </div>
  );
}

// ——— Session en cours ———

export function SessionPage() {
  const { active, go } = useStore();
  if (!active) {
    return (
      <div className="page page-narrow">
        <div className="card empty">
          <h2>Aucune session en cours</h2>
          <button className="btn btn-primary" onClick={() => go("/entrainement")}>Lancer un entraînement</button>
        </div>
      </div>
    );
  }
  if (active.index >= active.record.question_ids.length) return <SessionResults />;
  return <QuestionView key={`${active.record.id}-${active.index}`} />;
}

function QuestionView() {
  const { data, active, recordAnswer, advance, finishSession, abandonSession, go } = useStore();
  const rec = active!.record;
  const qid = rec.question_ids[active!.index];
  const q = data.content.questions.get(qid);
  const order = useMemo(() => (q ? displayOrder(q, rec.config.shuffle_options) : []), [q?.id]);
  const [selected, setSelected] = useState<string[]>([]);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [showCourse, setShowCourse] = useState(false);
  const started = useRef(Date.now());
  const total = rec.question_ids.length;
  const isLast = active!.index === total - 1;

  useEffect(() => {
    if (!q) advance(); // question devenue indisponible : on passe
  }, [q, advance]);

  const submit = async (confidence: Confidence | null) => {
    if (!q || grade || !selected.length) return;
    const g = gradeAnswer(q, selected, data.settings.multiple_scoring);
    setGrade(g);
    await recordAnswer({
      question_id: q.id, question_version: q.version, concept_ids: q.concept_ids, module_id: q.module_id,
      selected_option_ids: selected, displayed_option_ids: order, correct: g.correct, score: g.score, confidence,
      duration_ms: Math.min(Date.now() - started.current, 10 * 60_000),
    });
  };
  const next = async () => {
    if (isLast) await finishSession();
    advance();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showCourse || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (grade) next();
        else submit(null);
        return;
      }
      if (grade || !q) return;
      const k = e.key.toLowerCase();
      const pos = /^[1-8]$/.test(k) ? Number(k) - 1 : "abcdefgh".indexOf(k);
      if (pos >= 0 && pos < order.length) toggle(order[pos]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!q) return null;
  const multi = q.type === "multiple_choice";
  const toggle = (id: string) => {
    if (grade) return;
    setSelected((s) => (multi ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
  };
  const byId = new Map(q.options.map((o) => [o.id, o]));
  const mod = data.content.modules.get(q.module_id);
  const confusions = grade ? [...new Set(selected.map((s) => byId.get(s)?.confusion_concept_id).filter(Boolean) as string[])] : [];
  const sections = grade ? sectionsFor(data.content, q) : [];
  const mainConcept = data.content.concepts.get(q.concept_ids[0]);

  return (
    <div className="quiz">
      <div className="quiz-top">
        <button className="btn btn-ghost btn-sm" onClick={() => { abandonSession(); go("/"); }} aria-label="Quitter la session"><Icon name="x" size={18} /></button>
        <Bar pct={((active!.index + (grade ? 1 : 0)) / total) * 100} />
        <span className="muted mono">{active!.index + 1}/{total}</span>
      </div>
      <div className="quiz-meta">
        <span className="tag">{MODE_FR[rec.config.mode]}</span>
        {mod && <span className="tag">M{mod.number} · {mod.title}</span>}
        <span className="tag">{CATEGORY_FR[q.category]}</span>
        <span className="tag">{DIFFICULTY_FR[q.difficulty]}</span>
        {!data.attempts.some((a) => a.question_id === q.id && a.session_id !== rec.id) && <span className="tag tag-accent">Nouvelle</span>}
      </div>
      {q.vignette && <div className="vignette"><RichText text={q.vignette} /></div>}
      <div className="stem"><RichText text={q.question} /></div>
      <div className="hint">{TYPE_HINT[q.type]}</div>

      <div className={`options${multi ? " multi" : ""}`} role={multi ? "group" : "radiogroup"}>
        {order.map((id, i) => {
          const o = byId.get(id)!;
          const isSel = selected.includes(id);
          const isGood = q.correct_option_ids.includes(id);
          let cls = "option";
          if (grade) cls += isSel && isGood ? " good" : isSel ? " bad" : isGood ? " missed" : "";
          else if (isSel) cls += " sel";
          return (
            <button key={id} type="button" className={cls} disabled={!!grade} onClick={() => toggle(id)} aria-pressed={isSel} role={multi ? "checkbox" : "radio"} aria-checked={isSel}>
              <span className="letter">{grade && isGood ? <Icon name="check" size={16} /> : grade && isSel ? <Icon name="x" size={16} /> : q.type === "true_false" ? (id === "vrai" ? "V" : "F") : "ABCDEFGH"[i]}</span>
              <span className="option-body">
                {o.text}
                {grade && q.option_explanations[id] && <div className="option-why"><RichText text={q.option_explanations[id]} /></div>}
              </span>
            </button>
          );
        })}
      </div>

      {grade && (
        <>
          <div className={`verdict ${grade.correct ? "ok" : "ko"}`}>
            <Icon name={grade.correct ? "check" : "x"} size={22} />
            {grade.correct ? "Bonne réponse" : grade.score > 0 ? `Réponse partielle (${Math.round(grade.score * 100)} %)` : "Réponse incorrecte"}
          </div>
          <div className="explain">
            <h3>Correction</h3>
            <RichText text={q.explanation} />
            <SourceLine refs={q.sources} />
          </div>
          {!grade.correct && confusions.length > 0 && (
            <div className="explain">
              <h3>Confusion probable</h3>
              {confusions.map((cid) => {
                const c = data.content.concepts.get(cid);
                return <p key={cid}><strong>{c?.title ?? cid}</strong>{c?.summary ? ` — ${c.summary}` : ""}</p>;
              })}
            </div>
          )}
          {mainConcept?.summary && (
            <div className="explain">
              <h3>Notion : {mainConcept.title}</h3>
              <RichText text={mainConcept.summary} />
            </div>
          )}
          {sections.length > 0 && (
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setShowCourse(true)}>
              <Icon name="book" size={16} /> Revoir le cours : {sections[0].section.title}
            </button>
          )}
          {data.content.questions.get(q.id)?._needs_recheck && <div className="notice notice-warn" style={{ marginTop: 12 }}>Cette question a été corrigée récemment ; vérification pédagogique en attente.</div>}
        </>
      )}

      <div className="quiz-actions">
        {!grade && data.settings.ask_confidence && <div className="conf-label">Valider en indiquant votre degré de certitude</div>}
        <div className="quiz-actions-inner">
          {grade ? (
            <button className="btn btn-primary" onClick={next}>{isLast ? "Voir les résultats" : "Question suivante"} <Icon name="arrow" size={16} /></button>
          ) : data.settings.ask_confidence ? (
            <>
              <button className="btn" disabled={!selected.length} onClick={() => submit("guess")}>Au hasard</button>
              <button className="btn" disabled={!selected.length} onClick={() => submit("unsure")}>J'hésite</button>
              <button className="btn btn-primary" disabled={!selected.length} onClick={() => submit("sure")}>Sûr</button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={!selected.length} onClick={() => submit(null)}>Valider</button>
          )}
        </div>
      </div>

      {showCourse && (
        <Modal onClose={() => setShowCourse(false)} label="Rappel de cours">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <span className="tag">{sections[0].course.title}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowCourse(false)} aria-label="Fermer"><Icon name="x" size={18} /></button>
          </div>
          <div className="course">
            {sections.map((s) => <SectionView key={s.section.id} section={s.section} withActions={false} />)}
          </div>
        </Modal>
      )}
    </div>
  );
}

function SessionResults() {
  const { data, active, startSession, go, abandonSession } = useStore();
  const rec = active!.record;
  const atts = data.attempts.filter((a) => a.session_id === rec.id);
  const wrong = atts.filter((a) => !a.correct).map((a) => a.question_id);
  const correct = atts.length - wrong.length;
  const score = rec.score_20 ?? 0;
  return (
    <div className="page page-narrow">
      <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
        <div className="label">{MODE_FR[rec.config.mode]} · {atts.length} question(s)</div>
        <div style={{ fontSize: "3rem", fontWeight: 700, letterSpacing: "-0.03em", margin: "8px 0" }}>{score.toLocaleString("fr-FR")}<span className="faint" style={{ fontSize: "1.4rem" }}> / 20</span></div>
        <div className="muted">{correct} bonne(s) réponse(s) · {wrong.length} erreur(s) · {formatDuration(rec.duration_ms)}</div>
        <div className="row" style={{ justifyContent: "center", marginTop: 20 }}>
          {wrong.length > 0 && (
            <button className="btn btn-primary" onClick={() => startSession({ ...rec.config, mode: "errors", count: 9999, novelty: "all", part_ids: [], module_ids: [], difficulties: [] }, { onlyIds: wrong, preferredIds: wrong })}>
              Refaire les {wrong.length} erreur(s)
            </button>
          )}
          <button className="btn" onClick={() => { abandonSession(); go("/entrainement"); }}>Nouvel entraînement</button>
          <button className="btn btn-ghost" onClick={() => { abandonSession(); go("/"); }}>Tableau de bord</button>
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Détail</h2>
        <div className="list">
          {atts.map((a) => {
            const q = data.content.questions.get(a.question_id);
            return (
              <div key={a.id} className="list-item">
                <span className={`tag ${a.correct ? "tag-ok" : "tag-ko"}`}><Icon name={a.correct ? "check" : "x"} size={14} /></span>
                <div className="grow">
                  <div className="ellipsis">{q?.question ?? a.question_id}</div>
                  <div className="faint" style={{ fontSize: "0.78rem" }}>
                    {a.question_id} · {partOfModule(a.module_id)}
                    {a.confidence && ` · ${{ guess: "au hasard", unsure: "hésitant", sure: "sûr" }[a.confidence]}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
