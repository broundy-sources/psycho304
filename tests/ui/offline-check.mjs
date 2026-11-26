// Vérifie le fonctionnement hors ligne : 1re ouverture en ligne, puis coupure réseau,
// rechargement, navigation, réponse à une question, persistance.
// Usage : BASE=https://… node tests/ui/offline-check.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(execSync("npm root -g").toString().trim() + "/playwright")); }

const BASE = process.env.BASE ?? "http://localhost:5173/";
const results = [];
const check = (n, c, d = "") => { results.push({ n, ok: !!c }); console.log(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? undefined });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

// 1. Première ouverture en ligne
await page.goto(BASE);
await page.waitForSelector("h1");
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForSelector("h1");
check("service worker actif", await page.evaluate(() => !!navigator.serviceWorker.controller));
const cached = await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search); });
check("fichiers de l'application en cache", cached.length >= 10, `${cached.length} fichiers`);
const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
check("manifeste installable (nom, icônes 192/512, standalone)", manifest.display === "standalone" && manifest.icons.some((i) => i.sizes === "512x512"));

// Données de démonstration (pour avoir des questions)
await page.goto(BASE + "#/contenus");
await page.getByRole("button", { name: "Charger les données de démonstration" }).click();
await page.getByRole("button", { name: /Importer 1 fichier/ }).click();
await page.waitForSelector("text=paquet(s) importé(s)");

// 2. Coupure du réseau
await ctx.setOffline(true);
const offlineFetchFails = await page.evaluate(async () => { try { await fetch("https://example.com", { mode: "no-cors" }); return false; } catch { return true; } });
check("réseau coupé", offlineFetchFails);
await page.goto(BASE);
await page.waitForSelector("text=Continuer à apprendre", { timeout: 10000 });
check("contenus intégrés disponibles hors ligne", (await page.locator("text=Métapsychologie freudienne").count()) > 0);
check("l'application s'ouvre hors ligne (adresse de départ)", true);
await page.reload();
await page.waitForSelector(".kpi");
check("rechargement hors ligne", true);
await page.goto(BASE + "#/cours/P0-M01");
await page.waitForSelector(".course");
check("cours consultable hors ligne", true);
await page.goto(BASE + "#/");
await page.goto(BASE + "#/cours/P0-M01");
await page.getByRole("button", { name: /S'entraîner/ }).click();
await page.waitForSelector(".stem");
await page.locator(".option").first().click();
await page.getByRole("button", { name: "Sûr" }).click();
await page.waitForSelector(".verdict");
check("réponse à une question hors ligne", true);
await page.goto(BASE + "#/");
await page.reload();
await page.waitForSelector(".kpi");
const n = (await page.locator(".kpi", { hasText: "Réponses" }).locator(".kpi-value").innerText()).trim();
check("réponse conservée après rechargement hors ligne", n === "1", `Réponses = ${n}`);

// 3. Retour du réseau : rien de perdu
await ctx.setOffline(false);
await page.reload();
await page.waitForSelector(".kpi");
const n2 = (await page.locator(".kpi", { hasText: "Réponses" }).locator(".kpi-value").innerText()).trim();
check("progression intacte au retour du réseau", n2 === "1");
// 4. Mise à jour de l'application (nouvelle version publiée) : données conservées
if (process.env.TEST_UPDATE) {
  const src = () => page.evaluate(() => document.querySelector('script[src*="app.js"]').getAttribute("src"));
  const v1 = await src();
  execSync("bun scripts/build.ts", { cwd: new URL("../..", import.meta.url).pathname });
  await page.reload();
  await page.waitForSelector(".kpi");
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForSelector(".kpi");
  const v2 = await src();
  check("nouvelle version de l'appli chargée", v1 !== v2, `${v1} → ${v2}`);
  const n3 = (await page.locator(".kpi", { hasText: "Réponses" }).locator(".kpi-value").innerText()).trim();
  check("progression conservée après mise à jour", n3 === "1");
  check("contenus conservés après mise à jour", (await page.locator("text=Métapsychologie freudienne").count()) > 0);
}
check("aucune erreur JavaScript", errs.length === 0, errs.join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications hors ligne réussies`);
process.exit(failed ? 1 : 0);
