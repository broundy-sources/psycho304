import React, { useMemo, useRef, useState } from "react";
import { useStore } from "./store";
import { Icon, Modal, Seg, downloadJson, fmtDate } from "./components";
import { SourceStatus } from "./courses";
import { parsePackText, validatePack, type Issue } from "../core/pack-validator";
import { applyPlan, planImport, summarizeCounts, type ImportPlan } from "../core/importer";
import { isBackup } from "../core/backup";
import { isPlayable } from "../core/qcm";
import { APP_VERSION, commitImport, exportBackup, markRechecked, purgeDemo, resetEverything, restoreBackup } from "../db/repo";
import { get, put } from "../db/idb";
import { setSyncConfig } from "../sync/engine";
import { getSbConfig, sbSignIn, sbSignOut } from "../sync/sb-engine";
import { GitHub } from "../sync/github";
import type { ContentPack } from "../core/types";

interface Staged { name: string; issues: Issue[]; ok: boolean; pack?: ContentPack; plan?: ImportPlan; backup?: any; error?: string }

export function ContentPage() {
  const { data, reload, toast, setSetting, persisted } = useStore();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stage = (inputs: { name: string; text: string }[]) => {
    let sim = data.content;
    const out: Staged[] = [];
    for (const { name, text } of inputs) {
      const parsed = parsePackText(text);
      if (parsed.error) {
        out.push({ name, ok: false, issues: [], error: parsed.error });
        continue;
      }
      if (isBackup(parsed.data)) {
        out.push({ name, ok: true, issues: [], backup: parsed.data });
        continue;
      }
      const r = validatePack(parsed.data, sim);
      if (!r.ok) {
        out.push({ name, ok: false, issues: r.issues });
        continue;
      }
      const plan = planImport(sim, r.pack!);
      sim = applyPlan(sim, plan);
      out.push({ name, ok: true, issues: r.issues, pack: r.pack, plan });
    }
    setStaged(out);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const inputs = await Promise.all([...files].map(async (f) => ({ name: f.name, text: await f.text() })));
    inputs.sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
    stage(inputs);
  };

  const commit = async () => {
    setBusy(true);
    try {
      let n = 0;
      let msg = "";
      for (const s of staged) {
        if (!s.ok) continue;
        if (s.backup) {
          const sum = await restoreBackup(data, s.backup);
          msg = `Sauvegarde fusionnée : ${sum.attempts} réponse(s), ${sum.content} contenu(s) ajoutés`;
        } else if (s.pack && s.plan) {
          await commitImport(s.pack, s.plan);
          n++;
        }
      }
      await reload();
      if (n) msg = `${n} paquet(s) importé(s)${msg ? " · " + msg : ""}`;
      if (msg) toast(msg);
      setStaged([]);
      setPaste("");
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const loadDemo = async () => {
    const res = await fetch("./demo/paquet-demo.json");
    stage([{ name: "paquet-demo.json", text: await res.text() }]);
  };

  // ——— Contrôle de couverture (version lot 1) ———
  const cov = useMemo(() => {
    const qs = [...data.content.questions.values()];
    const playable = qs.filter(isPlayable);
    const withQ = new Set(playable.flatMap((q) => q.concept_ids));
    const tracked = [...data.content.concepts.values()].filter((c) => c.assessment !== "not_evaluated");
    return {
      concepts: tracked.length,
      noQuestion: tracked.filter((c) => !withQ.has(c.id)),
      toConfirm: tracked.filter((c) => c.assessment === "to_confirm").length,
      unverified: tracked.filter((c) => c.verification_status !== "verified").length,
      validated: playable.length,
      notValidated: qs.filter((q) => !isPlayable(q) && q.review_status !== "retired").length,
      recheck: qs.filter((q) => q._needs_recheck),
      sourcesTodo: [...data.content.sources.values()].filter((s) => s.integration_status !== "integrated"),
    };
  }, [data.content]);

  const hasDemo = [...data.content.parts.keys()].includes("P0");
  const packs = [...data.packs].sort((a, b) => b.imported_at.localeCompare(a.imported_at));

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div><h1>Gestion des contenus</h1><p>Import des paquets ChatGPT, couverture du programme, sauvegarde et réglages.</p></div>
      </div>

      <AccountCard />

      {/* Import */}
      <div className="card">
        <div className="card-head"><h2>Importer des paquets JSON</h2><span className="tag">format 1.0.0</span></div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
          style={{ border: `1.5px dashed ${drag ? "var(--accent)" : "var(--line-strong)"}`, borderRadius: "var(--radius)", padding: 24, textAlign: "center", background: drag ? "var(--accent-bg)" : "transparent" }}
        >
          <p className="muted">Déposez un ou plusieurs fichiers ici (paquets de contenus ou sauvegarde)</p>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> Choisir des fichiers</button>
          <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        </div>
        <div className="faint" style={{ fontSize: "0.82rem", marginTop: 10 }}>
          Format pour ChatGPT : <a href="./format/FORMAT_CONTENUS.md" download>documentation</a> · <a href="./format/psycho304-content.schema.json" download>schéma</a> · <a href="./format/exemple-paquet.json" download>exemple</a> · <a href="./format/valider_paquet.py" download>validateur</a>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>Ou coller le contenu JSON</summary>
          <textarea className="input" style={{ marginTop: 8 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{ "format": "psycho304-content", … }' />
          <button className="btn btn-sm" style={{ marginTop: 8 }} disabled={!paste.trim()} onClick={() => stage([{ name: "texte collé", text: paste }])}>Vérifier</button>
        </details>

        {staged.length > 0 && (
          <div className="stack" style={{ marginTop: 16 }}>
            {staged.map((s, i) => <StagedReport key={i} s={s} />)}
            <div className="row">
              <button className="btn btn-primary" disabled={busy || !staged.some((s) => s.ok)} onClick={commit}>
                {busy ? "Import…" : `Importer ${staged.filter((s) => s.ok).length} fichier(s) valide(s)`}
              </button>
              <button className="btn btn-ghost" onClick={() => setStaged([])}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      <SyncCard />

      {/* Couverture */}
      <div className="card">
        <div className="card-head"><h2>Couverture du programme</h2><span className="tag">aperçu · complet au lot 3</span></div>
        <div className="kpis kpis-4" style={{ marginBottom: 12 }}>
          <MiniKpi label="Notions suivies" value={cov.concepts} />
          <MiniKpi label="Notions sans question" value={cov.noQuestion.length} warn={cov.noQuestion.length > 0} />
          <MiniKpi label="Questions validées" value={cov.validated} />
          <MiniKpi label="Questions non validées" value={cov.notValidated} warn={cov.notValidated > 0} />
        </div>
        <div className="muted" style={{ fontSize: "0.88rem" }}>{cov.toConfirm} notion(s) à confirmer · {cov.unverified} notion(s) non vérifiée(s)</div>
        {cov.noQuestion.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}>Notions sans question validée ({cov.noQuestion.length})</summary>
            <div className="list">{cov.noQuestion.map((c) => <div className="list-item" key={c.id}><span className="tag mono">{c.id}</span><span className="grow">{c.title}</span></div>)}</div>
          </details>
        )}
        {cov.sourcesTodo.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}>Contenus universitaires restant à intégrer ({cov.sourcesTodo.length})</summary>
            <div className="list">{cov.sourcesTodo.map((s) => <div className="list-item" key={s.id}><span className="tag mono">{s.id}</span><span className="grow">{s.title}{s.notes && <div className="faint" style={{ fontSize: "0.8rem" }}>{s.notes}</div>}</span><SourceStatus status={s.integration_status} /></div>)}</div>
          </details>
        )}
        {cov.recheck.length > 0 && (
          <details style={{ marginTop: 10 }} open>
            <summary style={{ cursor: "pointer" }}>Questions corrigées à revérifier ({cov.recheck.length})</summary>
            <div className="list">
              {cov.recheck.map((q) => (
                <div className="list-item" key={q.id}>
                  <span className="tag mono">{q.id}</span>
                  <span className="grow ellipsis">{q.question}<div className="faint" style={{ fontSize: "0.8rem" }}>v{q.version}{q.revision_note ? ` — ${q.revision_note}` : ""}</div></span>
                  <button className="btn btn-sm" onClick={async () => { await markRechecked(q.id, data); await reload(); }}>Vérifiée</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Paquets installés */}
      <div className="card">
        <div className="card-head"><h2>Paquets importés ({packs.length})</h2></div>
        {packs.length ? (
          <div className="list">
            {packs.map((p) => (
              <div className="list-item" key={p.key}>
                <div className="grow">
                  <div style={{ fontWeight: 550 }} className="ellipsis">{(p.raw as any)?.pack?.title ?? p.key}</div>
                  <div className="faint" style={{ fontSize: "0.78rem" }}>{p.key} · {fmtDate(p.imported_at, true)} · {p.report}</div>
                </div>
                {(p.raw as any)?.pack?.kind === "demo" ? <span className="tag">démo</span> : <span className={`tag ${p.source === "bundled" ? "tag-accent" : ""}`}>{{ bundled: "intégré à l'appli", import: "importé ici", sync: "reçu par synchro", backup: "sauvegarde" }[p.source ?? "import"]}</span>}
              </div>
            ))}
          </div>
        ) : <p className="muted">Aucun paquet importé.</p>}
        <div className="row" style={{ marginTop: 12 }}>
          {!hasDemo && <button className="btn btn-sm" onClick={loadDemo}>Charger les données de démonstration</button>}
          {hasDemo && (
            <button className="btn btn-sm btn-danger" onClick={async () => {
              if (!confirm("Supprimer les données de démonstration (partie P0) et la progression associée ?")) return;
              const n = await purgeDemo(data);
              await reload();
              toast(`${n} élément(s) de démonstration supprimé(s)`);
            }}>Supprimer les données de démonstration</button>
          )}
        </div>
      </div>

      {/* Réglages */}
      <div className="card stack">
        <h2>Réglages</h2>
        <div className="field">
          <label htmlFor="exam">Date de l'examen</label>
          <input id="exam" className="input" type="date" value={data.settings.exam_date ?? ""} onChange={(e) => setSetting("exam_date", e.target.value || null)} style={{ maxWidth: 240 }} />
        </div>
        <div className="field">
          <span className="label">Barème des questions à réponses multiples</span>
          <Seg value={data.settings.multiple_scoring} onChange={(v) => setSetting("multiple_scoring", v)} options={[
            { v: "all_or_nothing", label: "Tout ou rien" },
            { v: "partial", label: "Partiel" },
            { v: "partial_with_penalty", label: "Partiel avec pénalité" },
          ]} />
          <span className="faint" style={{ fontSize: "0.8rem" }}>À ajuster quand le barème réel du partiel sera connu. N'affecte que les nouvelles réponses.</span>
        </div>
        <div className="field">
          <span className="label">Degré de certitude après chaque réponse</span>
          <Seg value={data.settings.ask_confidence ? "on" : "off"} onChange={(v) => setSetting("ask_confidence", v === "on")} options={[{ v: "on", label: "Demander" }, { v: "off", label: "Ne pas demander" }]} />
        </div>
        <div className="field">
          <span className="label">Thème</span>
          <Seg value={data.settings.theme} onChange={(v) => setSetting("theme", v)} options={[{ v: "dark", label: "Sombre" }, { v: "light", label: "Clair" }]} />
        </div>
      </div>

      {/* Sauvegarde */}
      <div className="card stack">
        <h2>Sauvegarde et transfert</h2>
        <p className="muted">L'export contient tous les contenus et toute la progression. La restauration <strong>fusionne</strong> : elle n'efface jamais rien et peut servir à transférer la progression vers un autre appareil (déposez le fichier dans la zone d'import ci-dessus).</p>
        <div className="row">
          <button className="btn btn-primary" onClick={async () => { downloadJson(`psycho304-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(data)); await put("meta", { key: "last_export", value: new Date().toISOString() }); toast("Sauvegarde exportée"); }}>
            <Icon name="download" size={16} /> Exporter la sauvegarde
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Restaurer une sauvegarde</button>
        </div>
        <div className="faint" style={{ fontSize: "0.82rem" }}>
          {data.attempts.length} réponse(s) · {data.sessions.length} session(s) · stockage {persisted ? "persistant" : persisted === false ? "non garanti (installez l'application sur l'écran d'accueil)" : "standard"} · v{APP_VERSION}
        </div>
        <LastExport />
      </div>

      <div className="card stack">
        <h2 style={{ color: "var(--ko)" }}>Zone sensible</h2>
        <p className="muted">Efface toutes les données de cet appareil (contenus et progression). Exportez une sauvegarde avant.</p>
        <div><button className="btn btn-danger" onClick={() => setConfirmReset(true)}>Réinitialiser l'application…</button></div>
      </div>
      {confirmReset && <ResetModal onClose={() => setConfirmReset(false)} />}
    </div>
  );
}

function ResetModal({ onClose }: { onClose: () => void }) {
  const [txt, setTxt] = useState("");
  const { data } = useStore();
  return (
    <Modal onClose={onClose} label="Confirmer la réinitialisation">
      <h2 style={{ marginBottom: 8 }}>Tout effacer ?</h2>
      <p className="muted">{data.attempts.length} réponse(s), {data.content.questions.size} question(s) et tous les réglages seront supprimés de cet appareil. Action irréversible.</p>
      <div className="field">
        <label htmlFor="conf">Tapez EFFACER pour confirmer</label>
        <input id="conf" className="input" value={txt} onChange={(e) => setTxt(e.target.value)} autoComplete="off" />
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => downloadJson(`psycho304-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(data))}>Exporter d'abord</button>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-danger" disabled={txt !== "EFFACER"} onClick={async () => { await resetEverything(); location.hash = "#/"; location.reload(); }}>Effacer</button>
      </div>
    </Modal>
  );
}

function MiniKpi({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="kpi" style={{ padding: "10px 12px" }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: "1.3rem", color: warn ? "var(--warn)" : undefined }}>{value}</div>
    </div>
  );
}

function StagedReport({ s }: { s: Staged }) {
  const errors = s.issues.filter((i) => i.level === "error");
  const warnings = s.issues.filter((i) => i.level === "warning");
  return (
    <div className={`notice ${s.ok ? (warnings.length ? "notice-warn" : "notice-ok") : "notice-ko"}`}>
      <div className="row-between">
        <strong>{s.name}</strong>
        <span className={`tag ${s.ok ? "tag-ok" : "tag-ko"}`}>{s.ok ? (s.backup ? "sauvegarde" : "valide") : "refusé"}</span>
      </div>
      {s.error && <div style={{ marginTop: 6 }}>{s.error}</div>}
      {s.pack && <div style={{ marginTop: 6 }}>{s.pack.pack.title} (v{s.pack.pack.version}) — {s.plan ? summarizeCounts(s.plan.counts) : ""}</div>}
      {s.backup && <div style={{ marginTop: 6 }}>Sauvegarde du {fmtDate(s.backup.exported_at, true)} : {s.backup.attempts.length} réponse(s). Sera fusionnée sans rien effacer.</div>}
      {errors.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, maxHeight: 240, overflow: "auto", fontSize: "0.85rem" }}>
          {errors.slice(0, 100).map((e, i) => <li key={i}><span className="mono">{e.where}</span> : {e.message}</li>)}
          {errors.length > 100 && <li>… et {errors.length - 100} autre(s)</li>}
        </ul>
      )}
      {(warnings.length > 0 || (s.plan?.warnings.length ?? 0) > 0) && (
        <details style={{ marginTop: 8, fontSize: "0.85rem" }}>
          <summary style={{ cursor: "pointer" }}>{warnings.length + (s.plan?.warnings.length ?? 0)} avertissement(s)</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {warnings.map((e, i) => <li key={i}><span className="mono">{e.where}</span> : {e.message}</li>)}
            {s.plan?.warnings.map((w, i) => <li key={`p${i}`}>{w}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}


function LastExport() {
  const [at, setAt] = useState<string | null>(null);
  React.useEffect(() => { get<{ key: string; value: string }>("meta", "last_export").then((r) => setAt(r?.value ?? null)); });
  return <div className="faint" style={{ fontSize: "0.82rem" }}>Dernière sauvegarde locale exportée depuis cet appareil : {at ? fmtDate(at, true) : "jamais"}</div>;
}

function guessDevice(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "PC Windows";
  if (/Macintosh/.test(ua)) return "Mac";
  return "Appareil";
}

export function SyncCard() {
  const { sync, syncNow, refreshSyncStatus, toast } = useStore();
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState(guessDevice());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const connect = async () => {
    setErr(null);
    const m = repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!m) return setErr("Indiquez le dépôt sous la forme propriétaire/nom, par exemple dimitri/psycho304-donnees");
    if (!token.trim()) return setErr("Collez le jeton d'accès GitHub");
    setBusy(true);
    try {
      const cfg = { owner: m[1], repo: m[2], token: token.trim(), device_label: label.trim() || guessDevice() };
      const info = await new GitHub(cfg).repoInfo();
      if (!info.private) throw new Error("ce dépôt est public : utilisez un dépôt privé pour protéger votre progression");
      if (!info.canPush) throw new Error("le jeton n'a pas le droit d'écriture sur ce dépôt (Contents : Read and write)");
      await setSyncConfig(cfg);
      await refreshSyncStatus();
      setToken("");
      const r = await syncNow(true);
      if (r) toast(`Connecté à ${info.full_name}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Sauvegarde supplémentaire GitHub <span className="faint" style={{ fontWeight: 400, fontSize: "0.85rem" }}>(facultatif)</span></h2>
        <span className={`tag ${sync.configured ? (sync.last_error ? "tag-warn" : "tag-ok") : ""}`}>{sync.configured ? (sync.running ? "en cours…" : sync.last_error ? "à vérifier" : "active") : "non configurée"}</span>
      </div>
      {sync.configured ? (
        <>
          <div className="muted" style={{ fontSize: "0.9rem" }}>
            Dépôt privé <span className="mono">{sync.repo}</span> · cet appareil : <strong>{sync.label}</strong><br />
            Dernière synchronisation réussie : {sync.last_success ? fmtDate(sync.last_success, true) : "jamais"}
            {!sync.online && " · hors ligne : synchronisation au retour du réseau"}
          </div>
          {sync.last_error && <div className="notice notice-warn" style={{ fontSize: "0.85rem" }}>Dernier problème : {sync.last_error}</div>}
          <div className="row">
            <button className="btn btn-primary" disabled={sync.running} onClick={() => syncNow(true)}>Synchroniser maintenant</button>
            <button className="btn btn-ghost" onClick={() => setConfirmOff(true)}>Déconnecter cet appareil…</button>
          </div>
          <div className="faint" style={{ fontSize: "0.8rem" }}>Automatique : à l'ouverture, toutes les 3 minutes, à la fin de chaque session, au retour du réseau et à la fermeture de l'appli. Chaque envoi est conservé dans l'historique du dépôt.</div>
          {confirmOff && (
            <Modal onClose={() => setConfirmOff(false)} label="Déconnecter la synchronisation">
              <h2 style={{ marginBottom: 8 }}>Déconnecter cet appareil ?</h2>
              <p className="muted">La synchronisation s'arrête sur cet appareil. Rien n'est effacé, ni ici ni sur GitHub ; le jeton est retiré de cet appareil.</p>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={() => setConfirmOff(false)}>Annuler</button>
                <button className="btn btn-danger" onClick={async () => { await setSyncConfig(null); await refreshSyncStatus(); setConfirmOff(false); }}>Déconnecter</button>
              </div>
            </Modal>
          )}
        </>
      ) : (
        <>
          <details>
          <summary className="muted" style={{ cursor: "pointer" }}>Copie complémentaire dans un dépôt GitHub privé (en plus du compte Supabase)</summary>
          <div className="stack" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="sync-repo">Dépôt privé (propriétaire/nom)</label>
            <input id="sync-repo" className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="votre-pseudo/psycho304-donnees" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </div>
          <div className="field">
            <label htmlFor="sync-token">Jeton d'accès GitHub (fine-grained)</label>
            <input id="sync-token" className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
            <span className="faint" style={{ fontSize: "0.8rem" }}>Conservé uniquement sur cet appareil, jamais inclus dans les sauvegardes exportées. <a href="https://github.com/settings/personal-access-tokens/new?name=Psycho+304+synchro&description=Synchronisation+de+l%27appli+Psycho+304&expires_in=180&contents=write" target="_blank" rel="noreferrer">Créer un jeton (formulaire pré-rempli)</a></span>
          </div>
          <div className="field">
            <label htmlFor="sync-label">Nom de cet appareil</label>
            <input id="sync-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} style={{ maxWidth: 260 }} />
          </div>
          {err && <div className="notice notice-ko" style={{ fontSize: "0.88rem" }}>{err}</div>}
          <div><button className="btn btn-primary" disabled={busy} onClick={connect}>{busy ? "Vérification…" : "Connecter et synchroniser"}</button></div>
          </div>
          </details>
        </>
      )}
    </div>
  );
}


export function AccountCard() {
  const { data, sync, syncNow, refreshSyncStatus, toast } = useStore();
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [baked, setBaked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);

  React.useEffect(() => {
    getSbConfig().then((c) => {
      if (c) {
        setUrl(c.url);
        setKey(c.key);
        setBaked(true);
      }
    });
  }, []);

  const localPacks = data.packs.filter((p) => p.source !== "bundled" && (p.raw as any)?.pack?.kind === "content").length;

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^https:\/\/[\w.-]+/.test(url.trim())) return setErr("Adresse du projet invalide (https://xxxx.supabase.co)");
    if (!key.trim()) return setErr("Clé publique manquante (sb_publishable_… ou clé anon)");
    if (!email.trim() || !password) return setErr("Saisissez l'e-mail et le mot de passe du compte");
    setBusy(true);
    try {
      await sbSignIn({ url: url.trim(), key: key.trim() }, email, password);
      setPassword("");
      await refreshSyncStatus();
      toast("Connecté — envoi et réception des données…");
      const r = await syncNow(true);
      if (r && !r.errors.length) toast(`Synchronisation terminée${r.pulled || r.packs ? ` : ${r.pulled} réponse(s) et ${r.packs} module(s) reçus` : ""}`);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Compte et synchronisation</h2>
        <span className={`tag ${sync.sbEmail ? (sync.sbError ? "tag-warn" : "tag-ok") : ""}`}>
          {sync.sbEmail ? (sync.running ? "synchronisation…" : sync.sbError ? "à vérifier" : "connecté") : "non connecté"}
        </span>
      </div>
      {sync.sbEmail ? (
        <>
          <div className="muted" style={{ fontSize: "0.9rem" }}>
            Connecté : <strong>{sync.sbEmail}</strong><br />
            Dernière synchronisation : {sync.sbLast ? fmtDate(sync.sbLast, true) : "en cours…"}
            {sync.pending > 0 && ` · ${sync.pending} élément(s) en attente d'envoi`}
            {!sync.online && " · hors ligne : envoi au retour du réseau"}
          </div>
          {sync.sbError && <div className="notice notice-warn" style={{ fontSize: "0.85rem" }}>Dernier problème : {sync.sbError}</div>}
          <div className="row">
            <button className="btn btn-primary" disabled={sync.running} onClick={() => syncNow(true)}>{sync.running ? "Synchronisation…" : "Synchroniser maintenant"}</button>
            <button className="btn btn-ghost" onClick={() => setConfirmOut(true)}>Se déconnecter…</button>
          </div>
          <div className="faint" style={{ fontSize: "0.8rem" }}>Automatique : à l'ouverture, toutes les 3 minutes, après chaque session ou import, au retour du réseau et à la mise en arrière-plan. Hors ligne, tout est enregistré sur l'appareil puis envoyé plus tard.</div>
          {confirmOut && (
            <Modal onClose={() => setConfirmOut(false)} label="Se déconnecter">
              <h2 style={{ marginBottom: 8 }}>Se déconnecter de cet appareil ?</h2>
              <p className="muted">La synchronisation s'arrête ici. Les contenus et la progression restent sur cet appareil et dans votre compte ; rien n'est effacé.{sync.pending > 0 && ` Attention : ${sync.pending} élément(s) pas encore envoyés — synchronisez d'abord.`}</p>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={() => setConfirmOut(false)}>Annuler</button>
                <button className="btn btn-danger" onClick={async () => { await sbSignOut(); await refreshSyncStatus(); setConfirmOut(false); toast("Déconnecté — données conservées sur l'appareil"); }}>Se déconnecter</button>
              </div>
            </Modal>
          )}
        </>
      ) : (
        <form className="stack" onSubmit={login}>
          <p className="muted" style={{ fontSize: "0.92rem" }}>
            Connectez-vous pour retrouver les mêmes contenus, la même progression et le même historique sur votre ordinateur, votre iPad et votre iPhone.
            {(data.attempts.length > 0 || localPacks > 0) && <> À la première connexion, les données de cet appareil (<strong>{data.attempts.length} réponse(s), {localPacks} module(s)</strong>) sont envoyées dans votre compte. Rien n'est effacé.</>}
          </p>
          {baked ? null : (
            <>
              <div className="field">
                <label htmlFor="sb-url">Adresse du projet Supabase</label>
                <input id="sb-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxxxxx.supabase.co" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </div>
              <div className="field">
                <label htmlFor="sb-key">Clé publique (publishable)</label>
                <input id="sb-key" className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="sb-email">E-mail</label>
            <input id="sb-email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sb-password">Mot de passe</label>
            <input id="sb-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {err && <div className="notice notice-ko" style={{ fontSize: "0.88rem" }}>{err}</div>}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
            {baked && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBaked(false)}>Paramètres du serveur</button>}
          </div>
        </form>
      )}
    </div>
  );
}
