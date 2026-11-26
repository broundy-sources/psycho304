// Test de bout en bout du lot 1 bis (Supabase simulé) :
// migration des données locales existantes, 2 appareils, hors ligne, expiration de session,
// récupération après effacement, déconnexion sans perte.
// Usage : node tests/ui/supabase-check.mjs   (avec « bun run serve » lancé)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { createFakeSupabase } from "../fake-supabase.mjs";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(execSync("npm root -g").toString().trim() + "/playwright")); }

const BASE = process.env.BASE ?? "http://localhost:5173/";
const SB_URL = "https://projet-test.supabase.co";
const FIXTURE = new URL("../fixtures/test-p2-m08.json", import.meta.url).pathname;
const results = [];
const check = (n, c, d = "") => { results.push({ n, ok: !!c }); console.log(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };

const fake = createFakeSupabase({ accessTtl: 3600, maxRows: 50 }); // pagination forcée
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? undefined });
const errs = [];

async function device(label, viewport) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  await ctx.route(SB_URL + "/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (fake.state.down) return route.abort("internetdisconnected");
    const r = fake.handle(req.method(), req.url(), await req.allHeaders(), req.postData() ?? "");
    await route.fulfill({ status: r.status, headers: { ...cors, "content-type": r.type }, body: r.body });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(`${label}: ${e.message}`));
  return { ctx, page };
}
const kpi = async (page, label) => (await page.locator(".kpi", { hasText: label }).locator(".kpi-value").innerText()).trim();
const answers = async (page) => { await page.goto(BASE + "#/"); await page.waitForSelector(".kpi"); return kpi(page, "Réponses"); };
async function answer(page, n) {
  await page.goto(BASE + "#/cours/P2-M08");
  await page.getByRole("button", { name: /S'entraîner/ }).click();
  for (let i = 0; i < n; i++) {
    await page.waitForSelector(".stem");
    await page.locator(".option").first().click();
    await page.getByRole("button", { name: "Sûr" }).click();
    await page.waitForSelector(".verdict");
    if (i < n - 1) await page.locator(".quiz-actions .btn-primary").click();
  }
  await page.getByRole("button", { name: "Quitter la session" }).click();
}
async function login(page, password = fake.users[0].password) {
  await page.goto(BASE + "#/contenus");
  await page.waitForSelector("#sb-email");
  await page.waitForTimeout(400);
  if (await page.locator("#sb-url").count()) {
    await page.fill("#sb-url", SB_URL);
    await page.fill("#sb-key", fake.key);
  }
  await page.fill("#sb-email", fake.users[0].email);
  await page.fill("#sb-password", password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}
async function syncNow(page) {
  await page.goto(BASE + "#/contenus");
  await page.waitForSelector(".toast", { state: "detached", timeout: 10000 });
  await page.getByRole("button", { name: "Synchroniser maintenant" }).click();
  await page.waitForSelector('.toast:text-matches("^Synchronis")', { timeout: 15000 });
}
const rows = (t) => fake.tables[t].length;

// ——— Appareil A : données locales AVANT la création du compte (situation actuelle) ———
const A = await device("PC", { width: 1440, height: 900 });
await A.page.goto(BASE + "#/contenus");
await A.page.setInputFiles("input[type=file]", FIXTURE);
await A.page.getByRole("button", { name: /Importer 1 fichier/ }).click();
await A.page.waitForSelector("text=paquet(s) importé(s)");
await A.page.fill("#exam", "2027-01-08");
await answer(A.page, 3);
// Historique volumineux déjà présent sur l'appareil (1 200 réponses anciennes)
await A.page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open("psycho304"); q.onsuccess = () => r(q.result); });
  const tx = db.transaction("attempts", "readwrite");
  const st = tx.objectStore("attempts");
  for (let i = 0; i < 1200; i++) st.put({ id: crypto.randomUUID(), session_id: "ancienne", question_id: "P2-M08-Q001", question_version: 1, concept_ids: ["P2-M08-C001"], module_id: "P2-M08", selected_option_ids: ["a"], displayed_option_ids: ["a", "b", "c"], correct: i % 3 !== 0, score: i % 3 !== 0 ? 1 : 0, confidence: "sure", duration_ms: 8000, answered_at: new Date(Date.UTC(2026, 10, 1) + i * 60000).toISOString(), mode: "free", first_seen: false, device_id: "ancien", _synced: 1 });
  await new Promise((r) => (tx.oncomplete = r));
});
await A.page.reload();
const before = await answers(A.page);
check("appareil A : données locales présentes avant connexion", before === "1203", before);

// Mauvais mot de passe
await login(A.page, "mauvais");
await A.page.waitForSelector("text=e-mail ou mot de passe incorrect");
check("mauvais mot de passe refusé avec un message clair", true);

// Connexion → migration
await login(A.page);
await A.page.waitForSelector('.toast:text-matches("^Synchronisation terminée")', { timeout: 20000 });
check("migration : module importé envoyé", fake.tables.content_packs.some((r) => r.key === "test-p2-m08@1"));
check("migration : les 1 203 réponses envoyées", rows("attempts") === 1203, `${rows("attempts")} en base`);
check("migration : sessions et réglages envoyés", rows("sessions") >= 1 && fake.tables.settings.some((s) => s.key === "exam_date"));
check("migration : données locales intactes", (await answers(A.page)) === "1203");
check("aucun module intégré (structure) envoyé inutilement", !fake.tables.content_packs.some((r) => r.key.startsWith("structure")));

// ——— Appareil B (iPad) vierge ———
const B = await device("iPad", { width: 1180, height: 820 });
await B.page.goto(BASE);
await B.page.waitForSelector(".kpi");
await login(B.page);
await B.page.waitForSelector('.toast:text-matches("^Synchronisation terminée")', { timeout: 20000 });
check("appareil B : historique complet récupéré (pagination)", (await answers(B.page)) === "1203");
await B.page.goto(BASE + "#/cours/P2-M08");
check("appareil B : module récupéré", (await B.page.locator("h1", { hasText: "[TEST] Module fictif" }).count()) === 1);
await B.page.goto(BASE + "#/contenus");
check("appareil B : date d'examen récupérée", (await B.page.inputValue("#exam")) === "2027-01-08");

// ——— Hors ligne sur B : réponse enregistrée puis envoyée au retour ———
fake.state.down = true;
const nBefore = rows("attempts");
await answer(B.page, 1);
check("hors ligne : réponse enregistrée localement", (await answers(B.page)) === "1204");
check("hors ligne : rien envoyé", rows("attempts") === nBefore);
fake.state.down = false;
await syncNow(B.page);
check("retour du réseau : réponse envoyée", rows("attempts") === nBefore + 1);

// ——— A récupère la réponse faite sur B ———
await syncNow(A.page);
check("appareil A : réponse de B récupérée (même historique)", (await answers(A.page)) === "1204");

// ——— Jeton expiré : rafraîchissement automatique ———
fake.state.accessTtl = 1;
await login(B.page).catch(() => {}); // B est déjà connecté : bouton absent, sans effet
const refreshesBefore = fake.stats.refreshes;
await B.page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open("psycho304"); q.onsuccess = () => r(q.result); });
  const tx = db.transaction("meta", "readwrite");
  const st = tx.objectStore("meta");
  const row = await new Promise((r) => { const q = st.get("sb_session"); q.onsuccess = () => r(q.result); });
  row.value.expires_at = Math.floor(Date.now() / 1000) - 5; // session expirée
  st.put(row);
  await new Promise((r) => (tx.oncomplete = r));
});
await syncNow(B.page);
check("session expirée : renouvelée automatiquement", fake.stats.refreshes > refreshesBefore);
fake.state.accessTtl = 3600;

// ——— Session révoquée : demande de reconnexion, données conservées ———
fake.revokeAll();
await B.page.goto(BASE + "#/contenus");
await B.page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open("psycho304"); q.onsuccess = () => r(q.result); });
  const tx = db.transaction("meta", "readwrite");
  const st = tx.objectStore("meta");
  const row = await new Promise((r) => { const q = st.get("sb_session"); q.onsuccess = () => r(q.result); });
  row.value.expires_at = 0;
  st.put(row);
  await new Promise((r) => (tx.oncomplete = r));
});
await B.page.getByRole("button", { name: "Synchroniser maintenant" }).click();
await B.page.waitForSelector("#sb-email", { timeout: 15000 });
check("session révoquée : formulaire de reconnexion affiché", true);
check("session révoquée : données locales conservées", (await answers(B.page)) === "1204");
await login(B.page);
await B.page.waitForSelector('.toast:text-matches("^Synchronisation terminée")', { timeout: 20000 });
check("reconnexion : aucune réponse dupliquée", rows("attempts") === 1204, `${rows("attempts")} en base`);

// ——— Effacement complet de A, reconnexion : tout revient ———
await A.ctx.close();
const A2 = await device("PC-réinstallé", { width: 1440, height: 900 });
await A2.page.goto(BASE);
await A2.page.waitForSelector(".kpi");
check("après effacement : appli vide avant connexion", (await kpi(A2.page, "Réponses")) === "0");
await login(A2.page);
await A2.page.waitForSelector('.toast:text-matches("^Synchronisation terminée")', { timeout: 20000 });
check("après effacement : historique complet récupéré", (await answers(A2.page)) === "1204");
await A2.page.goto(BASE + "#/cours/P2-M08");
check("après effacement : module récupéré", (await A2.page.locator("h1", { hasText: "[TEST]" }).count()) === 1);

// ——— Déconnexion : données conservées sur l'appareil ———
await A2.page.goto(BASE + "#/contenus");
await A2.page.getByRole("button", { name: "Se déconnecter…" }).click();
await A2.page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
await A2.page.waitForSelector("#sb-email");
check("déconnexion : données conservées sur l'appareil", (await answers(A2.page)) === "1204");

// ——— Isolation : un autre compte ne voit rien ———
check("en base : toutes les lignes appartiennent au compte", Object.values(fake.tables).every((t) => t.every((r) => r.user_id === fake.users[0].id)));

await browser.close();
check("aucune erreur JavaScript", errs.length === 0, errs.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications Supabase réussies`);
process.exit(failed ? 1 : 0);
