import React, { useMemo, useState } from "react";
import { useStore } from "./store";
import { Bar, Icon, RichText, Seg } from "./components";
import type { Block, ContentState, Course, Question, Section, SourceRef, TreeNode } from "../core/types";
import { isPlayable } from "../core/qcm";
import { conceptStats, coverage } from "../core/progress";

export function sectionsFor(content: ContentState, q: Question): { course: Course; section: Section }[] {
  const out: { course: Course; section: Section }[] = [];
  const wanted = new Set(q.course_section_ids ?? []);
  for (const course of content.courses.values()) {
    if (course.review_status === "retired") continue;
    for (const section of course.sections) {
      if (wanted.size ? wanted.has(section.id) : section.concept_ids.some((c) => q.concept_ids.includes(c))) out.push({ course, section });
    }
  }
  return out;
}

export function SourceLine({ refs }: { refs?: SourceRef[] }) {
  const { data } = useStore();
  if (!refs?.length) return null;
  return (
    <div className="src">
      Source : {refs.map((r, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {data.content.sources.get(r.source_id)?.title ?? r.source_id}, {r.location}
        </span>
      ))}
    </div>
  );
}

function Tree({ node }: { node: TreeNode }) {
  return (
    <li>
      <span className="tree-node">
        {node.label}
        {node.detail && <span className="muted"> — {node.detail}</span>}
      </span>
      {node.children?.length ? (
        <ul>
          {node.children.map((c, i) => (
            <Tree key={i} node={c} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case "text":
      return <div className="block"><RichText text={b.text} /></div>;
    case "key_point":
      return <div className="block key-point"><RichText text={b.text} /></div>;
    case "pitfall":
      return (
        <div className="block pitfall">
          <strong>Piège : </strong>
          <RichText text={b.text} />
        </div>
      );
    case "definition":
      return (
        <dl className="block definition">
          <dt>{b.term}{b.author && <span className="muted"> ({b.author})</span>}</dt>
          <dd><RichText text={b.definition} /></dd>
          {b.source && <SourceLine refs={[b.source]} />}
        </dl>
      );
    case "table":
      return (
        <div className="block">
          {b.title && <h3 style={{ marginBottom: 8 }}>{b.title}</h3>}
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>{b.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.caption && <div className="caption">{b.caption}</div>}
        </div>
      );
    case "diagram":
      return (
        <div className="block">
          {b.title && <h3 style={{ marginBottom: 10 }}>{b.title}</h3>}
          {b.kind === "flow" ? (
            <div className="flow">
              {b.steps.map((s, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="flow-arrow"><Icon name="arrow" size={18} /></span>}
                  <div className="flow-step">
                    <b>{s.label}</b>
                    {s.detail && <span className="muted">{s.detail}</span>}
                  </div>
                </React.Fragment>
              ))}
            </div>
          ) : (
            <ul className="tree"><Tree node={b.root} /></ul>
          )}
          {b.caption && <div className="caption">{b.caption}</div>}
        </div>
      );
    case "author":
      return (
        <div className="block author">
          <div className="avatar">{b.name.replace(/\[.*?\]\s*/, "").split(" ").map((w) => w[0]).slice(0, 2).join("")}</div>
          <div>
            <strong>{b.name}</strong> {b.dates && <span className="muted">({b.dates})</span>}
            <div><RichText text={b.contribution} /></div>
            {b.key_works?.length ? <div className="muted" style={{ fontSize: "0.9rem" }}>{b.key_works.map((w) => `${w.title}${w.year ? ` (${w.year})` : ""}`).join(" · ")}</div> : null}
          </div>
        </div>
      );
    case "example":
      return (
        <div className="block example">
          {b.title && <strong>{b.title}. </strong>}
          <RichText text={b.text} />
        </div>
      );
  }
}

export function SectionView({ section, withActions = true }: { section: Section; withActions?: boolean }) {
  const { data, startSession, toast } = useStore();
  const qIds = [...data.content.questions.values()].filter((q) => isPlayable(q) && q.concept_ids.some((c) => section.concept_ids.includes(c))).map((q) => q.id);
  return (
    <section>
      <h2 id={section.id}>{section.title}</h2>
      {section.blocks.map((b, i) => <BlockView key={i} b={b} />)}
      <SourceLine refs={section.sources} />
      {withActions && (
        <div className="sec-actions">
          <button
            className="btn btn-sm"
            disabled={!qIds.length}
            onClick={() => {
              const ok = startSession(
                { mode: "discovery", part_ids: [], module_ids: [], difficulties: [], count: 20, novelty: "all", shuffle_questions: true, shuffle_options: true },
                { onlyIds: qIds },
              );
              if (!ok) toast("Aucune question validée pour cette sous-partie");
            }}
          >
            <Icon name="play" size={16} /> QCM sur cette notion {qIds.length ? `(${qIds.length})` : ""}
          </button>
        </div>
      )}
    </section>
  );
}

export function CoursesPage({ moduleId }: { moduleId?: string }) {
  const { data } = useStore();
  if (moduleId) return <ModuleCourse moduleId={moduleId} />;
  const cs = conceptStats(data.attempts);
  const parts = [...data.content.parts.values()].sort((a, b) => a.order - b.order);
  const modules = [...data.content.modules.values()].sort((a, b) => a.number - b.number);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Mes cours</h1>
          <p>Cours condensés par module, définitions, auteurs et sources.</p>
        </div>
      </div>
      {!parts.length && <div className="card empty"><h2>Aucun contenu importé</h2><p>Importez les paquets fournis par ChatGPT dans « Contenus ».</p><a className="btn btn-primary" href="#/contenus">Importer des contenus</a></div>}
      {parts.map((p) => (
        <div className="card" key={p.id}>
          <div className="card-head"><h2>{p.title}</h2><span className="tag">{p.id}</span></div>
          <div className="list">
            {modules.filter((m) => m.part_id === p.id).map((m) => {
              const course = data.content.courses.get(`${m.id}-COURS`);
              const cov = coverage(data.content, cs, (x) => x === m.id);
              const nq = [...data.content.questions.values()].filter((q) => q.module_id === m.id && isPlayable(q)).length;
              return (
                <a key={m.id} href={`#/cours/${m.id}`} className="list-item" style={{ color: "inherit" }}>
                  <span className="tag">M{String(m.number).padStart(2, "0")}</span>
                  <div className="grow">
                    <div className="ellipsis" style={{ fontWeight: 600 }}>{m.title}</div>
                    <div className="faint" style={{ fontSize: "0.8rem" }}>
                      {course ? `${course.sections.length} sous-partie(s)` : "Cours à venir"} · {cov.total} notion(s) · {nq} question(s)
                    </div>
                  </div>
                  <div style={{ width: 110 }} className="hide-sm">
                    <Bar pct={cov.pct} />
                    <div className="faint" style={{ fontSize: "0.72rem", marginTop: 4 }}>{cov.pct} % rencontrées</div>
                  </div>
                  <Icon name="arrow" size={18} />
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModuleCourse({ moduleId }: { moduleId: string }) {
  const { data, startSession, toast } = useStore();
  const [tab, setTab] = useState<"cours" | "definitions" | "auteurs" | "sources">("cours");
  const m = data.content.modules.get(moduleId);
  const course = data.content.courses.get(`${moduleId}-COURS`);
  const blocks = useMemo(() => (course?.sections ?? []).flatMap((s) => s.blocks.map((b) => ({ b, s }))), [course]);
  if (!m) return <div className="page"><p>Module introuvable.</p><a href="#/cours">Retour</a></div>;
  const defs = blocks.filter((x) => x.b.type === "definition").sort((a, b) => (a.b as any).term.localeCompare((b.b as any).term, "fr"));
  const authors = blocks.filter((x) => x.b.type === "author");
  const sources = (m.source_ids ?? []).map((id) => data.content.sources.get(id)).filter(Boolean);
  const concepts = [...data.content.concepts.values()].filter((c) => c.module_id === moduleId);
  const nq = [...data.content.questions.values()].filter((q) => q.module_id === moduleId && isPlayable(q)).length;

  return (
    <div className="page">
      <a href="#/cours" className="row muted" style={{ marginBottom: 12, fontSize: "0.9rem" }}><Icon name="back" size={16} /> Mes cours</a>
      <div className="page-head">
        <div>
          <span className="tag" style={{ marginBottom: 8 }}>Module {m.number}</span>
          <h1>{m.title}</h1>
          {m.description && <p>{m.description}</p>}
        </div>
        <button
          className="btn btn-primary"
          disabled={!nq}
          onClick={() => {
            if (!startSession({ mode: "discovery", part_ids: [], module_ids: [moduleId], difficulties: [], count: 20, novelty: "all", shuffle_questions: true, shuffle_options: true }))
              toast("Aucune question validée pour ce module");
          }}
        >
          <Icon name="play" size={16} /> S'entraîner ({nq})
        </button>
      </div>
      <div style={{ marginBottom: 20 }}>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { v: "cours", label: "Cours" },
            { v: "definitions", label: `Définitions (${defs.length})` },
            { v: "auteurs", label: `Auteurs (${authors.length})` },
            { v: "sources", label: "Sources et notions" },
          ]}
        />
      </div>

      {tab === "cours" && (
        course ? (
          <div className="layout-course">
            <div className="course">
              {course.review_status !== "validated" && <div className="notice notice-warn" style={{ marginBottom: 16 }}>Cours non validé pédagogiquement ({course.review_status}).</div>}
              {course.introduction && <div className="block muted"><RichText text={course.introduction} /></div>}
              {course.sections.map((s) => <SectionView key={s.id} section={s} />)}
            </div>
            <aside className="card toc">
              <div className="label" style={{ marginBottom: 6 }}>Sommaire</div>
              {course.sections.map((s) => (
                <a key={s.id} href={`#/cours/${moduleId}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" }); }}>
                  {s.title}
                </a>
              ))}
            </aside>
          </div>
        ) : (
          <div className="card empty"><h2>Cours pas encore disponible</h2><p>Le cours condensé de ce module n'a pas encore été importé.</p></div>
        )
      )}

      {tab === "definitions" && (
        <div className="course">
          {defs.length ? defs.map((x, i) => <BlockView key={i} b={x.b} />) : <p className="muted">Aucune définition.</p>}
        </div>
      )}
      {tab === "auteurs" && (
        <div className="course">
          {authors.length ? authors.map((x, i) => <BlockView key={i} b={x.b} />) : <p className="muted">Aucun auteur.</p>}
        </div>
      )}
      {tab === "sources" && (
        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Documents universitaires</h2>
            {sources.length ? (
              <div className="list">
                {sources.map((s) => (
                  <div className="list-item" key={s!.id}>
                    <span className="tag">{s!.id}</span>
                    <div className="grow">{s!.title}{s!.file_name && <div className="faint mono">{s!.file_name}</div>}</div>
                    <SourceStatus status={s!.integration_status} />
                  </div>
                ))}
              </div>
            ) : <p className="muted">Aucune source rattachée.</p>}
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Notions du programme ({concepts.length})</h2>
            <div className="list">
              {concepts.map((c) => (
                <div className="list-item" key={c.id}>
                  <span className="tag mono">{c.id.slice(-4)}</span>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{c.title}</div>
                    {c.summary && <div className="muted" style={{ fontSize: "0.9rem" }}>{c.summary}</div>}
                    <div className="src">{c.sources.map((r) => `${r.source_id}, ${r.location}`).join(" · ")}</div>
                  </div>
                  {c.assessment === "to_confirm" && <span className="tag tag-warn">À confirmer</span>}
                  {c.assessment === "not_evaluated" && <span className="tag">Non évaluée</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SourceStatus({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    integrated: ["Intégré", "tag-ok"],
    partial: ["Partiel", "tag-warn"],
    pending: ["À intégrer", "tag-warn"],
    unavailable: ["Non disponible", ""],
  };
  const [label, cls] = map[status] ?? [status, ""];
  return <span className={`tag ${cls}`}>{label}</span>;
}
