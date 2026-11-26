import React, { useMemo } from "react";
import { useStore } from "./store";
import { Bar, Icon, MODE_FR, fmtDate } from "./components";
import { computeDashboard, currentErrors, daysUntil, formatDuration } from "../core/progress";

export function DashboardPage() {
  const { data, go, startSession, resumeSession, toast, sync } = useStore();
  const d = useMemo(() => computeDashboard(data.content, data.attempts, data.sessions), [data]);
  const errors = useMemo(() => currentErrors(data.attempts), [data.attempts]);
  const days = daysUntil(data.settings.exam_date);
  const unfinished = data.sessions
    .filter((s) => !s.ended_at && s.answered > 0 && s.answered < s.question_ids.length)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const empty = d.playableQuestions === 0;

  const learn = () => {
    const ok = startSession({ mode: "discovery", part_ids: [], module_ids: [], difficulties: [], count: 20, novelty: "all", shuffle_questions: true, shuffle_options: true });
    if (!ok) toast("Aucune question disponible");
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tableau de bord</h1>
          <p>UE 304 · Psychologie clinique et psychopathologies plurielles</p>
        </div>
        <a href="#/contenus" className={`tag ${days !== null && days <= 7 ? "tag-ko" : "tag-accent"}`} style={{ height: 32, padding: "0 12px", fontSize: "0.85rem" }}>
          <Icon name="clock" size={15} />&nbsp;
          {days === null ? "Définir la date de l'examen" : days > 0 ? `J-${days} · examen le ${new Date(data.settings.exam_date!).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : days === 0 ? "Examen aujourd'hui" : "Examen passé"}
        </a>
      </div>

      {!sync.configured && !empty && (
        <div className="notice notice-warn row-between" style={{ marginBottom: 16 }}>
          <span>Progression enregistrée uniquement sur cet appareil. Activez la sauvegarde distante pour la protéger et la retrouver sur vos autres appareils.</span>
          <a className="btn btn-sm" href="#/contenus">Activer</a>
        </div>
      )}
      {sync.configured && sync.last_error && (
        <div className="notice notice-warn row-between" style={{ marginBottom: 16 }}>
          <span>Synchronisation : {sync.last_error}</span>
          <a className="btn btn-sm" href="#/contenus">Vérifier</a>
        </div>
      )}
      {empty ? (
        <div className="card empty">
          <h2>Aucune question disponible</h2>
          <p>Importez les paquets JSON produits par ChatGPT, ou chargez les données de démonstration pour essayer l'application.</p>
          <a className="btn btn-primary" href="#/contenus"><Icon name="upload" size={16} /> Importer des contenus</a>
        </div>
      ) : (
        <div className="row" style={{ marginBottom: 20 }}>
          {unfinished && (
            <button className="btn btn-primary" onClick={() => resumeSession(unfinished)}>
              <Icon name="play" size={16} /> Reprendre la session ({unfinished.answered}/{unfinished.question_ids.length})
            </button>
          )}
          <button className={`btn${unfinished ? "" : " btn-primary"}`} onClick={learn}><Icon name="book" size={16} /> Continuer à apprendre</button>
          {errors.length > 0 && (
            <button className="btn" onClick={() => go("/erreurs")}><Icon name="alert" size={16} /> {errors.length} erreur(s) à revoir</button>
          )}
          <button className="btn btn-ghost" onClick={() => go("/entrainement")}>Entraînement personnalisé</button>
        </div>
      )}

      <div className="kpis">
        <Kpi label="Notions rencontrées" value={`${d.overall.pct} %`} sub={`${d.overall.encountered} / ${d.overall.total} notions`} />
        <Kpi label="Notions consolidées" value="—" sub="calculé à partir du lot 2" />
        <Kpi label="Réussite au 1er essai" value={d.firstTryRate === null ? "—" : `${d.firstTryRate} %`} sub={`${d.questionsSeen} question(s) vue(s)`} />
        <Kpi label="Réponses" value={String(d.answered)} sub={d.successRate === null ? "" : `${d.successRate} % de réussite`} />
        <Kpi label="Erreurs" value={String(d.errors)} sub={`${errors.length} non corrigée(s)`} />
        <Kpi label="Temps de révision" value={formatDuration(d.timeMs)} sub="temps de réponse cumulé" />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h2>Progression par partie</h2><span className="faint" style={{ fontSize: "0.8rem" }}>notions rencontrées</span></div>
          {d.parts.length ? d.parts.map((p) => (
            <div key={p.id} style={{ marginBottom: 14 }}>
              <div className="row-between" style={{ marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }} className="ellipsis">{p.id} · {p.title}</span>
                <span className="mono muted">{p.cov.pct} %</span>
              </div>
              <Bar pct={p.cov.pct} />
            </div>
          )) : <p className="muted">Aucune partie importée.</p>}
          <div className="notice" style={{ marginTop: 8, fontSize: "0.82rem" }}>
            « Rencontrée » = au moins une question traitée sur la notion. Ce n'est pas une maîtrise : les niveaux de consolidation arrivent avec le lot 2 (réussites espacées sur des formulations différentes).
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Notions les moins maîtrisées</h2></div>
          {d.weakest.length ? (
            <div className="list">
              {d.weakest.map((w) => (
                <a key={w.id} className="list-item" href={`#/cours/${w.module_id}`} style={{ color: "inherit" }}>
                  <div className="grow">
                    <div className="ellipsis" style={{ fontWeight: 600 }}>{w.title}</div>
                    <div className="faint" style={{ fontSize: "0.78rem" }}>{w.errors} erreur(s) sur {w.attempts} réponse(s)</div>
                  </div>
                  <span className={`tag ${w.rate < 50 ? "tag-ko" : "tag-warn"}`}>{w.rate} %</span>
                </a>
              ))}
            </div>
          ) : <p className="muted">Pas encore d'erreur enregistrée.</p>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h2>Modules</h2><a href="#/cours" className="btn btn-ghost btn-sm">Mes cours</a></div>
        <div className="list">
          {d.modules.map((m) => (
            <a key={m.id} href={`#/cours/${m.id}`} className="list-item" style={{ color: "inherit" }}>
              <span className="tag">M{String(m.number).padStart(2, "0")}</span>
              <div className="grow">
                <div className="ellipsis" style={{ fontWeight: 550 }}>{m.title}</div>
                <div className="faint" style={{ fontSize: "0.78rem" }}>
                  {m.questions} question(s){m.successRate !== null ? ` · ${m.successRate} % de réussite` : ""}{m.status === "planned" ? " · à venir" : ""}
                </div>
              </div>
              <div style={{ width: 140 }}>
                <Bar pct={m.cov.pct} />
                <div className="faint" style={{ fontSize: "0.72rem", marginTop: 4, textAlign: "right" }}>{m.cov.encountered}/{m.cov.total} notions</div>
              </div>
            </a>
          ))}
          {!d.modules.length && <p className="muted">Aucun module importé.</p>}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><h2>Derniers résultats</h2><a href="#/stats" className="btn btn-ghost btn-sm">Historique</a></div>
          {d.recentSessions.length ? (
            <div className="list">
              {d.recentSessions.map((s) => (
                <div key={s.id} className="list-item">
                  <div className="grow">
                    <div style={{ fontWeight: 550 }}>{MODE_FR[s.config.mode]} · {s.answered} question(s)</div>
                    <div className="faint" style={{ fontSize: "0.78rem" }}>{fmtDate(s.started_at, true)} · {formatDuration(s.duration_ms)}</div>
                  </div>
                  <span className="mono" style={{ fontWeight: 650 }}>{(s.score_20 ?? 0).toLocaleString("fr-FR")}/20</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">Aucune session terminée.</p>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Révisions du jour</h2><span className="tag">Lot 2</span></div>
          <p className="muted">La répétition espacée (révision le lendemain, à 3, 7 puis 14 jours) planifiera ici les notions à revoir chaque jour.</p>
          <p className="muted" style={{ marginBottom: 0 }}>En attendant : refaites vos erreurs et utilisez le mode découverte module par module.</p>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
