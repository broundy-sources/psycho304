// Tests du client Supabase contre un faux serveur fidèle au schéma.
import { describe, expect, test } from "bun:test";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { Supabase, normalizeUrl } from "../src/sync/supabase";

const URL_ = "https://exemple.supabase.co";
const make = (fake: any) => new Supabase({ url: URL_, key: fake.key }, fake.fetchImpl);

describe("client Supabase", () => {
  test("connexion, erreurs en français", async () => {
    const fake = createFakeSupabase();
    const sb = make(fake);
    const s = await sb.signIn("moi@exemple.fr", "motdepasse-test");
    expect(s.user.email).toBe("moi@exemple.fr");
    expect(s.expires_at).toBeGreaterThan(Date.now() / 1000);
    await expect(sb.signIn("moi@exemple.fr", "faux")).rejects.toThrow("e-mail ou mot de passe incorrect");
    await expect(new Supabase({ url: URL_, key: "mauvaise" }, fake.fetchImpl as any).signIn("moi@exemple.fr", "motdepasse-test")).rejects.toThrow();
  });

  test("rafraîchissement : nouveau jeton, ancien jeton de rafraîchissement invalidé", async () => {
    const fake = createFakeSupabase();
    const sb = make(fake);
    const s = await sb.signIn("moi@exemple.fr", "motdepasse-test");
    const s2 = await sb.refresh(s.refresh_token);
    expect(s2.access_token).not.toBe(s.access_token);
    await expect(sb.refresh(s.refresh_token)).rejects.toThrow("session expirée");
  });

  test("envoi en ajout seul (doublons ignorés) et lecture incrémentale", async () => {
    const fake = createFakeSupabase();
    const sb = make(fake);
    const { access_token: t } = await sb.signIn("moi@exemple.fr", "motdepasse-test");
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `00000000-0000-0000-0000-00000000000${i}`, answered_at: "2026-11-26T10:00:00Z", data: { i } }));
    await sb.upsert(t, "attempts", rows, "id", "ignore");
    await sb.upsert(t, "attempts", [{ ...rows[0], data: { i: 99 } }], "id", "ignore");
    const all = await sb.select<any>(t, "attempts", "select=data,row_seq&row_seq=gt.0&order=row_seq.asc&limit=1000");
    expect(all.length).toBe(5);
    expect(all[0].data.i).toBe(0);
    const after = await sb.select<any>(t, "attempts", `select=data,row_seq&row_seq=gt.${all[2].row_seq}&order=row_seq.asc&limit=1000`);
    expect(after.length).toBe(2);
  });

  test("sessions : la plus récente gagne", async () => {
    const fake = createFakeSupabase();
    const sb = make(fake);
    const { access_token: t } = await sb.signIn("moi@exemple.fr", "motdepasse-test");
    const id = "11111111-0000-0000-0000-000000000000";
    await sb.upsert(t, "sessions", [{ id, updated_at: "2026-11-26T10:00:00Z", data: { n: 5 } }], "id", "merge");
    await sb.upsert(t, "sessions", [{ id, updated_at: "2026-11-26T09:00:00Z", data: { n: 1 } }], "id", "merge");
    expect((await sb.select<any>(t, "sessions", "select=data,row_seq"))[0].data.n).toBe(5);
    await sb.upsert(t, "sessions", [{ id, updated_at: "2026-11-26T11:00:00Z", data: { n: 8 } }], "id", "merge");
    expect((await sb.select<any>(t, "sessions", "select=data,row_seq"))[0].data.n).toBe(8);
  });

  test("jeton expiré détecté (401) ; hors ligne signalé", async () => {
    const fake = createFakeSupabase({ accessTtl: -10 });
    const sb = make(fake);
    const { access_token: t } = await sb.signIn("moi@exemple.fr", "motdepasse-test");
    await expect(sb.select(t, "attempts", "select=data")).rejects.toMatchObject({ status: 401 });
    fake.state.down = true;
    await expect(sb.select(t, "attempts", "select=data")).rejects.toThrow("pas de connexion");
  });

  test("adresse du projet normalisée", () => {
    expect(normalizeUrl(" https://abc.supabase.co/rest/v1/ ")).toBe("https://abc.supabase.co");
    expect(normalizeUrl("https://abc.supabase.co/")).toBe("https://abc.supabase.co");
  });
});
