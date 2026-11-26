import React, { useMemo, useState } from "react";
import { useStore } from "./store";
import { Chip, Icon, MODE_FR, RichText, fmtDate } from "./components";
import { currentErrors, formatDuration } from "../core/progress";
import { partOfModule } from "../core/qcm";
import { sectionsFor } from "./courses";

export function ErrorsPage() {
  const { data, startSession, go, toast } = useStore();
  const [part, setPart] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(() => currentErrors(data.attempts).filter((e) => data.content.questions.has(e.question_id)), [data]);
  const list = all.filter((e) => !part || partOfModule(data.content.questions.get(e.question_id)!.module_id) === part);
  const parts = [...data.content.parts.values()].sort((a, b) => a.order - b.order);

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>Mes erreurs</h1>
          <p>Questions dont la dernière réponse était fausse. Elles disparaissent de cette liste une fois réussies.</p>
        </div>
        <button
          className="btn btn-primary"
          disabled={!list.length}
          onClick={() => {
            const ids = list.map((e) => e.question_id);
            if (!startSession({ mode: "errors", part_ids: [], module_ids: [], difficulties: [], count: 9999, novelty: "all", shuffle_questions: true, shuffle_options: true }, { onlyIds: ids }))
              toast("Ces questions ne sont plus disponibles");
          }}
        >
          <Icon name="play" size={16} /> Refaire ({list.length})
        </button>
      </div>
      <div className="chips" style={{ marginBottom: 16 }}>
        <Chip on={!part} onClick={() => setPart(null)}>Toutes ({all.length})</Chip>
        {parts.map((p) => <Chip key={p.id} on={part === p.id} onClick={() => setPart(p.id)}>{p.id}</Chip>)}
      </div>
      {!list.length ? (
        <div className="card empty"><h2>Aucune erreur en cours</h2><p>Les erreurs commises pendant les entraînements apparaîtront ici.</p><button className="btn" onClick={() => go("/entrainement")}>S'entraîner</button></div>
      ) : (
        <div className="card">
          <div className="list">
            {list.map((e) => {
              const q = data.content.questions.get(e.question_id)!;
              const mod = data.content.modules.get(q.module_id);
              const isOpen = open === q.id;
              const byId = new Map(q.options.map((o) => [o.id, o]));
              const sec = sectionsFor(data.content, q)[0];
              return (
                <div key={q.id} className="list-item" style={{ alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
                  <button type="button" className="row-between" style={{ width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }} onClick={() => setOpen(isOpen ? null : q.id)} aria-expanded={isOpen}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{q.question}</div>
                      <div className="faint" style={{ fontSize: "0.78rem" }}>M{mod?.number} · {mod?.title} · {e.count} erreur(s) · dernière le {fmtDate(e.lastAt)}</div>
                    </div>
                    <span className="tag tag-ko">{e.count}×</span>
                  </button>
                  {isOpen && (
                    <div style={{ width: "100%" }}>
                      <div className="explain" style={{ marginTop: 4 }}>
                        <h3>Votre dernière réponse</h3>
                        {e.lastSelected.map((s) => <p key={s} style={{ color: "var(--ko)" }}>✗ {byId.get(s)?.text ?? s}{q.option_explanations[s] ? <span className="muted"> — {q.option_explanations[s]}</span> : null}</p>)}
                        <h3 style={{ marginTop: 10 }}>Bonne(s) réponse(s)</h3>
                        {q.correct_option_ids.map((s) => <p key={s} style={{ color: "var(--ok)" }}>✓ {byId.get(s)?.text}</p>)}
                        <h3 style={{ marginTop: 10 }}>Correction</h3>
                        <RichText text={q.explanation} />
                      </div>
                      {sec && <a className="btn btn-sm" style={{ marginTop: 10 }} href={`#/cours/${q.module_id}`}><Icon name="book" size={16} /> {sec.section.title}</a>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="faint" style={{ fontSize: "0.82rem", marginTop: 16 }}>Le carnet d'erreurs complet (confusions, fréquences, filtres par notion, historique conservé après consolidation) arrive avec le lot 2.</p>
    </div>
  );
}

export function StatsPage() {
  const { data } = useStore();
  const sessions = [...data.sessions].filter((s) => s.answered > 0).sort((a, b) => b.started_at.localeCompare(a.started_at));
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div><h1>Statistiques</h1><p>Historique des sessions. Les statistiques détaillées arrivent avec le lot 3.</p></div>
      </div>
      <div className="card">
        {sessions.length ? (
          <div className="list">
            {sessions.map((s) => (
              <div key={s.id} className="list-item">
                <div className="grow">
                  <div style={{ fontWeight: 550 }}>{MODE_FR[s.config.mode]} · {s.answered}/{s.question_ids.length} question(s){!s.ended_at && <span className="tag" style={{ marginLeft: 8 }}>interrompue</span>}</div>
                  <div className="faint" style={{ fontSize: "0.78rem" }}>{fmtDate(s.started_at, true)} · {formatDuration(s.duration_ms)} · {s.correct} bonne(s) réponse(s)</div>
                </div>
                <span className="mono" style={{ fontWeight: 650 }}>{s.score_20 !== undefined ? `${s.score_20.toLocaleString("fr-FR")}/20` : `${Math.round((s.correct / s.answered) * 100)} %`}</span>
              </div>
            ))}
          </div>
        ) : <div className="empty"><p>Aucune session pour l'instant.</p></div>}
      </div>
    </div>
  );
}

export function ExamsPage() {
  return (
    <div className="page page-narrow">
      <div className="page-head"><div><h1>Partiels blancs</h1><p>Simulation des conditions d'examen.</p></div></div>
      <div className="card empty">
        <h2>Prévu au lot 3</h2>
        <p>Nombre de questions et durée configurables, sans correction pendant l'épreuve, questions marquées, navigation libre, note sur 20 et analyse détaillée, priorité aux questions jamais rencontrées.</p>
      </div>
    </div>
  );
}
