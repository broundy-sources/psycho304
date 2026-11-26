// Tests de la synchronisation (logique pure + client GitHub contre un faux serveur).
import { describe, expect, test } from "bun:test";
import { createFakeGitHub } from "./fake-github.mjs";
import { GitHub, GhError, toBase64Utf8 } from "../src/sync/github";
import { buildProgressFile, combineRemote, packFileName, packsToUpload, parseProgressFile, progressFingerprint } from "../src/core/sync-logic";
import { mergeBackup, type Snapshot } from "../src/core/backup";
import type { Attempt, SessionRecord } from "../src/core/types";

const att = (id: string, device: string, at = "2026-11-26T10:00:00Z"): Attempt => ({
  id, session_id: "s", question_id: "P0-M01-Q001", question_version: 1, concept_ids: ["P0-M01-C001"], module_id: "P0-M01",
  selected_option_ids: ["a"], displayed_option_ids: ["a", "b"], correct: true, score: 1, confidence: "sure", duration_ms: 1000,
  answered_at: at, mode: "free", first_seen: true, device_id: device,
});
const sess = (id: string, updated: string, answered: number): SessionRecord => ({
  id, config: { mode: "free", part_ids: [], module_ids: [], difficulties: [], count: 10, novelty: "all", shuffle_questions: true, shuffle_options: true },
  question_ids: [], started_at: "2026-11-26T09:00:00Z", answered, correct: answered, duration_ms: 0, updated_at: updated, device_id: "x",
});
const empty = (): Snapshot => ({ content: { sources: [], parts: [], modules: [], concepts: [], courses: [], questions: [] }, history: [], packs: [], attempts: [], sessions: [], settings: [] });

describe("client GitHub", () => {
  test("accents et caractères spéciaux conservés à l'aller-retour", async () => {
    const fake = createFakeGitHub();
    const gh = new GitHub({ owner: fake.owner, repo: fake.repo, token: fake.token }, fake.fetchImpl as any);
    const text = JSON.stringify({ t: "Métapsychologie « freudienne » — œdipe ✓" });
    await gh.put("progression/a.json", text, "test");
    expect(await gh.getText("progression/a.json")).toBe(text);
    expect((await gh.list("progression")).map((e) => e.name)).toEqual(["a.json"]);
    expect(await gh.list("contenus")).toEqual([]);
    expect(await gh.getText("absent.json")).toBeNull();
  });

  test("remplacement exige la bonne version (sha) ; conflit détecté", async () => {
    const fake = createFakeGitHub();
    const gh = new GitHub({ owner: fake.owner, repo: fake.repo, token: fake.token }, fake.fetchImpl as any);
    const sha1 = await gh.put("f.json", "1", "v1");
    await gh.put("f.json", "2", "v2", sha1);
    await expect(gh.put("f.json", "3", "v3", sha1)).rejects.toMatchObject({ status: 409 });
  });

  test("jeton invalide, dépôt introuvable, dépôt public signalés", async () => {
    const fake = createFakeGitHub({ isPrivate: false });
    await expect(new GitHub({ owner: fake.owner, repo: fake.repo, token: "faux" }, fake.fetchImpl as any).repoInfo()).rejects.toThrow("jeton GitHub invalide");
    await expect(new GitHub({ owner: fake.owner, repo: "autre", token: fake.token }, fake.fetchImpl as any).repoInfo()).rejects.toThrow("introuvable");
    expect((await new GitHub({ owner: fake.owner, repo: fake.repo, token: fake.token }, fake.fetchImpl as any).repoInfo()).private).toBe(false);
  });

  test("hors ligne : erreur réseau explicite", async () => {
    const gh = new GitHub({ owner: "a", repo: "b", token: "c" }, (async () => { throw new TypeError("Failed to fetch"); }) as any);
    await expect(gh.list("x")).rejects.toBeInstanceOf(GhError);
  });

  test("base64 UTF-8 sur un gros fichier", () => {
    const s = "é".repeat(200_000);
    expect(Buffer.from(toBase64Utf8(s), "base64").toString("utf8")).toBe(s);
  });
});

describe("fusion de la progression entre appareils", () => {
  test("union des réponses de plusieurs appareils, sans doublon", () => {
    const pc = buildProgressFile({ attempts: [att("1", "pc"), att("2", "pc")], sessions: [], settings: [] }, "pc", "PC");
    const ipad = buildProgressFile({ attempts: [att("2", "pc"), att("3", "ipad")], sessions: [], settings: [] }, "ipad", "iPad");
    const combined = combineRemote([pc, ipad]);
    expect(combined.attempts.map((a) => a.id).sort()).toEqual(["1", "2", "3"]);
    // appareil local qui possède déjà la réponse 1 : seules 2 et 3 sont ajoutées
    const local = { ...empty(), attempts: [att("1", "pc")] };
    const { summary } = mergeBackup(local, combined);
    expect(summary.attempts).toBe(2);
  });

  test("session : la version la plus récente gagne ; réglage : idem", () => {
    const a = buildProgressFile({ attempts: [], sessions: [sess("s1", "2026-11-26T10:00:00Z", 3)], settings: [{ key: "exam_date", value: "2026-12-18", updated_at: "2026-11-26T10:00:00Z" }] }, "a", "A");
    const b = buildProgressFile({ attempts: [], sessions: [sess("s1", "2026-11-26T11:00:00Z", 7)], settings: [{ key: "exam_date", value: "2026-12-19", updated_at: "2026-11-26T09:00:00Z" }] }, "b", "B");
    const c = combineRemote([a, b]);
    expect(c.sessions[0].answered).toBe(7);
    expect(c.settings[0].value).toBe("2026-12-18");
  });

  test("appareil effacé : tout revient depuis le dépôt", () => {
    const remote = buildProgressFile({ attempts: [att("1", "old"), att("2", "old")], sessions: [sess("s1", "2026-11-26T10:00:00Z", 2)], settings: [] }, "old", "Ancien");
    const { summary } = mergeBackup(empty(), combineRemote([remote]));
    expect(summary).toMatchObject({ attempts: 2, sessions: 1 });
  });

  test("empreinte stable : pas de réécriture si rien n'a changé", () => {
    const f1 = buildProgressFile({ attempts: [att("2", "pc"), att("1", "pc")], sessions: [], settings: [] }, "pc", "PC", "2026-11-26T10:00:00Z");
    const f2 = buildProgressFile({ attempts: [att("1", "pc"), { ...att("2", "pc"), _synced: 1 } as any], sessions: [], settings: [] }, "pc", "PC", "2026-11-26T12:00:00Z");
    expect(progressFingerprint(f1)).toBe(progressFingerprint(f2));
    expect(parseProgressFile(JSON.stringify(f1))?.attempts.length).toBe(2);
    expect(parseProgressFile("{}")).toBeNull();
  });

  test("seuls les paquets importés à la main (réels) sont envoyés", () => {
    const pk = (key: string, source: any, kind = "content") => ({ key, imported_at: "2026-11-26", raw: { pack: { kind } }, source });
    const up = packsToUpload([pk("structure@1", "bundled"), pk("p1-m02@1", "import"), pk("demo@1", "import", "demo"), pk("p1-m03@1", "sync")], new Set([packFileName("p1-m03@1")]));
    expect(up.map((p) => p.key)).toEqual(["p1-m02@1"]);
    expect(packFileName("p1-m02@1")).toBe("p1-m02_1.json");
  });
});
