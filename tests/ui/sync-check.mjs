// Test de bout en bout : contenus intégrés, persistance, synchronisation entre deux appareils
// et récupération après effacement complet du navigateur. GitHub est simulé (faux serveur en mémoire).
// Usage : node tests/ui/sync-check.mjs   (avec « bun run serve » lancé)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { createFakeGitHub } from "../fake-github.mjs";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(execSync("npm root -g").toString().trim() + "/playwright")); }

const BASE = process.env.BASE ?? "http://localhost:5173/";
const FIXTURE = new URL("../fixtures/test-p2-m08.json", import.meta.url).pathname;
const results = [];
const check = (n, c, d = "") => { results.push({ n, ok: !!c }); console.log(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };

const fake = createFakeGitHub();
// Le dépôt privé contient déjà le module de cours (comme en production)
fake.files.set("contenus/p1-m01_1.json", { text: readFileSync(new URL("../../../depot-donnees/contenus/p1-m01_1.json", import.meta.url), "utf8"), sha: "init" });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? undefined });
const errs = [];

async function device(label, viewport) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  await ctx.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,PUT,OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const r = fake.handle(req.method(), req.url(), await req.allHeaders(), req.postData() ?? "");
    await route.fulfill({ status: r.status, headers: { ...cors, "content-type": r.text ? "text/plain" : "application/json" }, body: r.text ?? JSON.stringify(r.json) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(`${label}: ${e.message}`));
  return { ctx, page };
}
const kpi = async (page, label) => (await page.locator(".kpi", { hasText: label }).locator(".kpi-value").innerText()).trim();
async function answer(page, n) {
  await page.goto(BASE + "#/");
  await page.getByRole("button", { name: "Continuer à apprendre" }).click();
  for (let i = 0; i < n; i++) {
    await page.waitForSelector(".stem");
    await page.locator(".option").first().click();
    await page.getByRole("button", { name: "Sûr" }).click();
    await page.waitForSelector(".verdict");
    if (i < n - 1) await page.locator(".quiz-actions .btn-primary").click();
  }
  await page.getByRole("button", { name: "Quitter la session" }).click();
}
async function connect(page, label) {
  await page.goto(BASE + "#/contenus");
  await page.fill("#sync-repo", `${fake.owner}/${fake.repo}`);
  await page.fill("#sync-token", fake.token);
  await page.fill("#sync-label", label);
  await page.getByRole("button", { name: "Connecter et synchroniser" }).click();
  await page.waitForSelector('.toast:text-matches("^Connecté à")', { timeout: 15000 });
}
async function syncNow(page) {
  await page.goto(BASE + "#/contenus");
  await page.waitForSelector(".toast", { state: "detached", timeout: 10000 });
  await page.getByRole("button", { name: "Synchroniser maintenant" }).click();
  await page.waitForSelector('.toast:text-matches("^Synchronis")', { timeout: 15000 });
}

// ——— Appareil A (PC) ———
const A = await device("PC", { width: 1440, height: 900 });
await A.page.goto(BASE);
await A.page.waitForSelector(".kpi");
check("structure du programme présente dès la 1re ouverture", (await A.page.locator("text=Métapsychologie freudienne").count()) > 0);
check("site public : aucun module de cours intégré", (await A.page.locator("text=Histoire et fondements de la psychologie clinique").count()) === 0);
await A.page.goto(BASE + "#/");
await A.page.reload();
await A.page.waitForSelector(".kpi");
const packsA = await A.page.evaluate(() => window.__psycho304Seed);
check("2e ouverture : rien n'est réimporté (déjà installé)", packsA.imported.length === 0 && packsA.errors.length === 0);

// Mauvais jeton refusé proprement
await A.page.goto(BASE + "#/contenus");
await A.page.fill("#sync-repo", `${fake.owner}/${fake.repo}`);
await A.page.fill("#sync-token", "mauvais");
await A.page.getByRole("button", { name: "Connecter et synchroniser" }).click();
await A.page.waitForSelector("text=jeton GitHub invalide");
check("jeton invalide refusé avec un message clair", true);

await connect(A.page, "PC Windows");
check("connexion au dépôt privé", fake.files.has([...fake.files.keys()].find((k) => k.startsWith("progression/")) ?? "x"));
await A.page.goto(BASE + "#/cours/P1-M01");
await A.page.waitForSelector(".course");
check("module P1-M01 reçu du dépôt privé (5 sous-parties)", (await A.page.locator(".course > section").count()) === 5);

// Import manuel d'un nouveau module (fictif) puis réponses
await A.page.goto(BASE + "#/contenus");
await A.page.setInputFiles("input[type=file]", FIXTURE);
await A.page.getByRole("button", { name: /Importer 1 fichier/ }).click();
await A.page.waitForSelector("text=paquet(s) importé(s)");
await answer(A.page, 3);
await syncNow(A.page);
check("module importé envoyé au dépôt", [...fake.files.keys()].some((k) => k.startsWith("contenus/test-p2-m08")));
await A.page.goto(BASE + "#/");
const ansA = await kpi(A.page, "Réponses");

// ——— Appareil B (iPad) ———
const B = await device("iPad", { width: 1180, height: 820 });
await B.page.goto(BASE);
await B.page.waitForSelector(".kpi");
check("appareil B : structure présente sans configuration", (await B.page.locator("text=Métapsychologie freudienne").count()) > 0);
await connect(B.page, "iPad");
await B.page.goto(BASE + "#/");
await B.page.waitForSelector(".kpi");
check("appareil B : progression de A récupérée", (await kpi(B.page, "Réponses")) === ansA, `A=${ansA}`);
await B.page.goto(BASE + "#/cours/P2-M08");
check("appareil B : module importé sur A récupéré", (await B.page.locator("h1", { hasText: "[TEST] Module fictif synchronisé" }).count()) === 1);
await answer(B.page, 1);
await syncNow(B.page);

// Retour sur A
await syncNow(A.page);
await A.page.goto(BASE + "#/");
check("appareil A : réponse faite sur B récupérée", (await kpi(A.page, "Réponses")) === String(Number(ansA) + 1));

// ——— Perte totale du navigateur sur A, puis reconnexion ———
await A.ctx.close();
const A2 = await device("PC-réinstallé", { width: 1440, height: 900 });
await A2.page.goto(BASE);
await A2.page.waitForSelector(".kpi");
check("après effacement : structure revenue immédiatement", (await A2.page.locator("text=Métapsychologie freudienne").count()) > 0);
await connect(A2.page, "PC Windows (réinstallé)");
await A2.page.goto(BASE + "#/");
await A2.page.waitForSelector(".kpi");
check("après effacement : toute la progression récupérée", (await kpi(A2.page, "Réponses")) === String(Number(ansA) + 1));
await A2.page.goto(BASE + "#/cours/P2-M08");
check("après effacement : module importé récupéré", (await A2.page.locator("h1", { hasText: "[TEST]" }).count()) === 1);
await A2.page.goto(BASE + "#/cours/P1-M01");
check("après effacement : module P1-M01 récupéré", (await A2.page.locator(".course > section").count()) === 5);

// Pas d'écriture inutile : une synchro sans changement ne crée pas de commit
const before = fake.commits.length;
await syncNow(A2.page);
await syncNow(A2.page);
check("synchronisation sans changement : aucun envoi superflu", fake.commits.length === before, `${fake.commits.length - before} envoi(s)`);
check("historique distant (un commit par envoi)", fake.commits.length > 0, `${fake.commits.length} commits`);

await browser.close();
check("aucune erreur JavaScript", errs.length === 0, errs.join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications de synchronisation réussies`);
process.exit(failed ? 1 : 0);
