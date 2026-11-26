import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadAll, requestPersistence, saveAttempt, saveSession, saveSetting, uuid, type AppData } from "../db/repo";
import { buildSession, type BuildOptions } from "../core/qcm";
import { getSyncConfig, getSyncState, runSync, type SyncConfig } from "../sync/engine";
import { getSbConfig, getSbSession, getSbState, pendingCounts, runSbSync } from "../sync/sb-engine";
import type { Attempt, SessionConfig, SessionRecord, Settings } from "../core/types";

export interface ActiveSession { record: SessionRecord; index: number }

export interface SyncStatus {
  /** Supabase : compte personnel (synchronisation principale) */
  sbConfigured: boolean;
  sbEmail?: string;
  sbLast?: string;
  sbError?: string;
  pending: number;
  /** GitHub : sauvegarde supplémentaire facultative */
  configured: boolean;
  label?: string;
  repo?: string;
  last_success?: string;
  last_error?: string;
  running: boolean;
  online: boolean;
}

export interface SyncOutcome { pulled: number; packs: number; errors: string[] }

interface Store {
  data: AppData;
  reload: () => Promise<void>;
  route: string;
  go: (hash: string) => void;
  toast: (msg: string) => void;
  persisted: boolean | null;
  active: ActiveSession | null;
  startSession: (cfg: SessionConfig, opts?: BuildOptions) => boolean;
  resumeSession: (s: SessionRecord) => void;
  recordAnswer: (a: Omit<Attempt, "id" | "session_id" | "device_id" | "answered_at" | "first_seen" | "mode">) => Promise<void>;
  advance: () => void;
  finishSession: () => Promise<void>;
  abandonSession: () => void;
  setSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => Promise<void>;
  sync: SyncStatus;
  syncNow: (manual?: boolean) => Promise<SyncOutcome | null>;
  scheduleSync: () => void;
  refreshSyncStatus: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

function currentRoute() {
  return (location.hash || "#/").slice(1) || "/";
}

export function StoreProvider({ initial, children }: { initial: AppData; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const [route, setRoute] = useState(currentRoute());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ sbConfigured: false, pending: 0, configured: false, running: false, online: typeof navigator === "undefined" ? true : navigator.onLine });
  const syncLock = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSyncStatus = useCallback(async () => {
    const cfg: SyncConfig | null = await getSyncConfig();
    const st = await getSyncState();
    const sbCfg = await getSbConfig();
    const sbSess = await getSbSession();
    const sbSt = sbSess ? await getSbState(sbSess.user.id) : null;
    const p = await pendingCounts();
    setSync((s) => ({
      ...s,
      sbConfigured: !!sbCfg,
      sbEmail: sbSess?.user.email,
      sbLast: sbSt?.last_success,
      sbError: sbSt?.last_error,
      pending: p.attempts + p.sessions + p.packs,
      configured: !!cfg,
      label: cfg?.device_label,
      repo: cfg ? `${cfg.owner}/${cfg.repo}` : undefined,
      last_success: st.last_success,
      last_error: st.last_error,
    }));
  }, []);

  /** Synchronise avec Supabase (si connecté) puis GitHub (si configuré). Ne bloque jamais l'appli. */
  const syncNow = useCallback(async (manual = false): Promise<SyncOutcome | null> => {
    const sbSess = await getSbSession();
    const ghCfg = await getSyncConfig();
    if ((!sbSess && !ghCfg) || syncLock.current) return null;
    if (!navigator.onLine && !manual) return null;
    syncLock.current = true;
    setSync((s) => ({ ...s, running: true }));
    const out: SyncOutcome = { pulled: 0, packs: 0, errors: [] };
    let changed = false;
    try {
      if (sbSess) {
        try {
          const r = await runSbSync();
          out.pulled += r.pulled.attempts;
          out.packs += r.pulled.packs.length;
          out.errors.push(...r.errors);
          changed ||= !!(r.pulled.attempts || r.pulled.packs.length || r.pulled.sessions || r.pulled.settings);
        } catch (e) {
          out.errors.push(`Supabase : ${(e as Error).message}`);
        }
      }
      if (ghCfg) {
        try {
          const r = await runSync(ghCfg);
          out.pulled += r.pulledAttempts;
          out.packs += r.pulledPacks.length;
          changed ||= !!(r.pulledAttempts || r.pulledPacks.length);
        } catch (e) {
          out.errors.push(`GitHub : ${(e as Error).message}`);
        }
      }
      if (changed) setData(await loadAll());
      if (manual) {
        if (out.errors.length) setToastMsg(`Synchronisation incomplète — ${out.errors[0]}`);
        else setToastMsg(out.pulled || out.packs ? `Synchronisé : ${out.pulled} réponse(s) et ${out.packs} module(s) reçus` : "Synchronisé");
      }
      return out;
    } finally {
      syncLock.current = false;
      setSync((s) => ({ ...s, running: false }));
      await refreshSyncStatus();
    }
  }, [refreshSyncStatus]);

  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void syncNow(), 4000);
  }, [syncNow]);

  useEffect(() => {
    refreshSyncStatus().then(() => setTimeout(() => void syncNow(), 1500));
    const onOnline = () => {
      setSync((s) => ({ ...s, online: true }));
      void syncNow();
    };
    const onOffline = () => setSync((s) => ({ ...s, online: false }));
    const onVis = () => {
      if (document.visibilityState === "hidden") void syncNow();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") void syncNow();
    }, 3 * 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(iv);
    };
  }, [refreshSyncStatus, syncNow]);

  useEffect(() => {
    const on = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    requestPersistence().then(setPersisted);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
    try {
      localStorage.setItem("psycho304-theme", data.settings.theme);
    } catch {}
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", data.settings.theme === "dark" ? "#0f1115" : "#f6f7f9");
  }, [data.settings.theme]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2800);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const reload = useCallback(async () => {
    setData(await loadAll());
    scheduleSync();
  }, [scheduleSync]);
  const go = useCallback((h: string) => {
    if (location.hash === "#" + h) {
      setRoute(h);
    } else location.hash = h;
  }, []);

  const startSession = useCallback(
    (cfg: SessionConfig, opts?: BuildOptions) => {
      const ids = buildSession(data.content, data.attempts, cfg, opts);
      if (!ids.length) return false;
      const now = new Date().toISOString();
      const record: SessionRecord = {
        id: uuid(), config: cfg, question_ids: ids, started_at: now, answered: 0, correct: 0, duration_ms: 0, updated_at: now, device_id: data.deviceId,
      };
      saveSession(record);
      setData((d) => ({ ...d, sessions: [...d.sessions, record] }));
      setActive({ record, index: 0 });
      go("/session");
      return true;
    },
    [data, go],
  );

  const resumeSession = useCallback(
    (s: SessionRecord) => {
      const done = new Set(data.attempts.filter((a) => a.session_id === s.id).map((a) => a.question_id));
      const idx = s.question_ids.findIndex((id) => !done.has(id));
      setActive({ record: s, index: idx < 0 ? s.question_ids.length : idx });
      go("/session");
    },
    [data.attempts, go],
  );

  const recordAnswer: Store["recordAnswer"] = useCallback(
    async (partial) => {
      if (!active) return;
      const seenBefore = data.attempts.some((a) => a.question_id === partial.question_id);
      const a: Attempt = {
        ...partial,
        id: uuid(),
        session_id: active.record.id,
        device_id: data.deviceId,
        answered_at: new Date().toISOString(),
        first_seen: !seenBefore,
        mode: active.record.config.mode,
      };
      const rec: SessionRecord = {
        ...active.record,
        answered: active.record.answered + 1,
        correct: active.record.correct + (a.correct ? 1 : 0),
        duration_ms: active.record.duration_ms + a.duration_ms,
        updated_at: a.answered_at,
      };
      await saveAttempt(a);
      await saveSession(rec);
      setData((d) => ({ ...d, attempts: [...d.attempts, a], sessions: d.sessions.map((s) => (s.id === rec.id ? rec : s)) }));
      setActive((cur) => (cur ? { ...cur, record: rec } : cur));
    },
    [active, data.attempts, data.deviceId],
  );

  const advance = useCallback(() => setActive((cur) => (cur ? { ...cur, index: cur.index + 1 } : cur)), []);

  const finishSession = useCallback(async () => {
    if (!active) return;
    const now = new Date().toISOString();
    const scores = data.attempts.filter((a) => a.session_id === active.record.id).map((a) => a.score);
    const rec: SessionRecord = {
      ...active.record,
      ended_at: now,
      updated_at: now,
      score_20: scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 2000) / 100 : 0,
    };
    await saveSession(rec);
    setData((d) => ({ ...d, sessions: d.sessions.map((s) => (s.id === rec.id ? rec : s)) }));
    setActive((cur) => (cur ? { ...cur, record: rec } : cur));
    scheduleSync();
  }, [active, data.attempts, scheduleSync]);

  const abandonSession = useCallback(() => setActive(null), []);

  const setSetting = useCallback(async <K extends keyof Settings>(k: K, v: Settings[K]) => {
    await saveSetting(k, v);
    const row = { key: k, value: v, updated_at: new Date().toISOString() };
    setData((d) => ({ ...d, settings: { ...d.settings, [k]: v }, settingRows: [...d.settingRows.filter((r) => r.key !== k), row] }));
    scheduleSync();
  }, [scheduleSync]);

  const value = useMemo<Store>(
    () => ({ data, reload, route, go, toast: setToastMsg, persisted, active, startSession, resumeSession, recordAnswer, advance, finishSession, abandonSession, setSetting, sync, syncNow, scheduleSync, refreshSyncStatus }),
    [data, reload, route, go, persisted, active, startSession, resumeSession, recordAnswer, advance, finishSession, abandonSession, setSetting, sync, syncNow, scheduleSync, refreshSyncStatus],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}
