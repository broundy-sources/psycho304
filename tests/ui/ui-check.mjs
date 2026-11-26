// Test de bout en bout dans Chromium (Playwright) : import, QCM, persistance, sauvegarde/restauration,
// refus des fichiers invalides, affichage ordinateur / iPad / téléphone.
// Usage : node tests/ui/ui-check.mjs   (après « bun run build » et avec « bun run serve » lancé)
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(execSync("npm root -g").toString().trim() + "/playwright"));
}

const BASE = process.env.BASE ?? "http://localhost:5173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? undefined });
const errors = [];

async function newPage(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, hasTouch: !!opts.touch, isMobile: !!opts.mobile, deviceScaleFactor: opts.scale ?? 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return { ctx, page };
}

const kpi = async (page, label) => (await page.locator(".kpi", { hasText: label }).locator(".kpi-value").innerText()).trim();

// ——— 1. Ordinateur : parcours complet ———
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 });
  await page.goto(BASE);
  await page.waitForSelector("h1");
  check("démarrage : contenus de base intégrés présents", (await page.locator("text=Métapsychologie freudienne").count()) > 0);
  await page.screenshot({ path: OUT + "01-accueil-vide.png" });

  // Fichier d'exemple refusé
  await page.goto(BASE + "#/contenus");
  await page.setInputFiles('input[type=file]', new URL("../../contenu-format/exemple-paquet.json", import.meta.url).pathname);
  await page.waitForSelector(".notice-ko");
  check("fichier d'exemple refusé à l'import", await page.getByText("refusé").first().isVisible());
  // JSON invalide refusé
  await page.setInputFiles('input[type=file]', { name: "casse.json", mimeType: "application/json", buffer: Buffer.from("{ pas du json") });
  await page.waitForSelector("text=JSON illisible");
  check("JSON illisible refusé", true);
  await page.getByRole("button", { name: "Annuler" }).click();

  // Démo
  await page.getByRole("button", { name: "Charger les données de démonstration" }).click();
  await page.waitForSelector("text=valide");
  await page.screenshot({ path: OUT + "02-import-rapport.png", fullPage: true });
  await page.getByRole("button", { name: /Importer 1 fichier/ }).click();
  await page.waitForSelector("text=paquet(s) importé(s)");
  check("import du paquet de démonstration", await page.getByText("demo-technique@1").isVisible());
  await page.fill("#exam", "2026-12-18");

  await page.goto(BASE + "#/");
  await page.waitForSelector("text=Continuer à apprendre");
  check("compte à rebours affiché", await page.getByText(/J-\d+ · examen le 18 décembre/).isVisible());

  // Session sur le module de démonstration M01 : on répond à tout ; première proposition affichée
  await page.goto(BASE + "#/cours/P0-M01");
  await page.getByRole("button", { name: /S'entraîner/ }).click();
  await page.waitForSelector(".stem");
  const total = Number((await page.locator(".quiz-top .mono").innerText()).split("/")[1]);
  check("session lancée (validées uniquement, une seule reformulation par groupe)", total === 5, `${total} question(s)`);
  let stems = [];
  for (let i = 0; i < total; i++) {
    stems.push(await page.locator(".stem").innerText());
    await page.locator(".option").first().click();
    if (i === 0) await page.screenshot({ path: OUT + "03-question.png" });
    await page.getByRole("button", { name: "Sûr" }).click();
    await page.waitForSelector(".verdict");
    if (i === 0) await page.screenshot({ path: OUT + "04-correction.png", fullPage: true });
    await page.locator(".quiz-actions .btn-primary").click();
  }
  check("question non validée jamais posée", !stems.some((s) => s.includes("ne doit jamais apparaître")));
  await page.waitForSelector("text=/ 20");
  await page.screenshot({ path: OUT + "05-resultats.png", fullPage: true });
  const answered = await page.locator(".list-item").count();
  check("toutes les réponses enregistrées", answered === total, `${answered}`);

  // Persistance après rechargement
  await page.goto(BASE + "#/");
  await page.reload();
  await page.waitForSelector(".kpi");
  check("progression conservée après fermeture", (await kpi(page, "Réponses")) === String(total));
  await page.screenshot({ path: OUT + "06-tableau-de-bord.png", fullPage: true });

  // Cours
  await page.goto(BASE + "#/cours/P0-M01");
  await page.waitForSelector(".course");
  await page.screenshot({ path: OUT + "07-cours.png", fullPage: true });
  check("cours : tableau, schémas, auteur affichés", (await page.locator("table.t").count()) === 1 && (await page.locator(".flow-step").count()) === 3 && (await page.locator(".author").count()) === 1);

  // Erreurs
  await page.goto(BASE + "#/erreurs");
  await page.waitForSelector("h1");
  await page.screenshot({ path: OUT + "08-erreurs.png", fullPage: true });
  const nErr = await page.locator(".list-item").count();
  check("liste des erreurs", nErr > 0, `${nErr} erreur(s)`);

  // Réimport identique : aucun changement, progression intacte
  await page.goto(BASE + "#/contenus");
  await page.getByRole("button", { name: "Supprimer les données de démonstration" }).isVisible();
  await page.setInputFiles('input[type=file]', new URL("../../public/demo/paquet-demo.json", import.meta.url).pathname);
  await page.waitForSelector("text=aucun changement");
  check("réimport identique : aucun changement", true);
  await page.getByRole("button", { name: "Annuler" }).click();

  // Export de la sauvegarde
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter la sauvegarde" }).click()]);
  const backupPath = OUT + "sauvegarde-test.json";
  await dl.saveAs(backupPath);
  check("export de la sauvegarde", true, dl.suggestedFilename());
  await page.screenshot({ path: OUT + "09-contenus.png", fullPage: true });
  await ctx.close();

  // ——— 2. Autre appareil (contexte vierge) : restauration ———
  const b = await newPage({ width: 1180, height: 820 }, { touch: true });
  await b.page.goto(BASE + "#/contenus");
  await b.page.waitForSelector("input[type=file]", { state: "attached" });
  await b.page.setInputFiles("input[type=file]", backupPath);
  await b.page.waitForSelector("text=sauvegarde");
  await b.page.getByRole("button", { name: /Importer 1 fichier/ }).click();
  await b.page.waitForSelector("text=Sauvegarde fusionnée");
  await b.page.goto(BASE + "#/");
  await b.page.waitForSelector(".kpi");
  { const v = await kpi(b.page, "Réponses"); check("restauration sur un autre appareil", v === String(total), `Réponses=${v}, attendu ${total}`); }
  // restaurer deux fois ne duplique rien
  await b.page.goto(BASE + "#/contenus");
  await b.page.setInputFiles("input[type=file]", backupPath);
  await b.page.getByRole("button", { name: /Importer 1 fichier/ }).click();
  await b.page.waitForSelector("text=Sauvegarde fusionnée : 0 réponse");
  check("double restauration sans doublon", true);
  // iPad paysage
  await b.page.goto(BASE + "#/");
  await b.page.waitForSelector(".kpi");
  await b.page.screenshot({ path: OUT + "10-ipad-paysage.png" });
  await b.page.setViewportSize({ width: 820, height: 1180 });
  await b.page.screenshot({ path: OUT + "11-ipad-portrait.png" });
  await b.page.getByRole("button", { name: "Continuer à apprendre" }).click();
  await b.page.waitForSelector(".stem");
  await b.page.locator(".option").nth(1).tap();
  await b.page.screenshot({ path: OUT + "12-ipad-question.png" });
  await b.ctx.close();
}

// ——— 3. Téléphone ———
{
  const { ctx, page } = await newPage({ width: 390, height: 844 }, { touch: true, mobile: true, scale: 2 });
  await page.goto(BASE + "#/contenus");
  await page.getByRole("button", { name: "Charger les données de démonstration" }).click();
  await page.getByRole("button", { name: /Importer 1 fichier/ }).click();
  await page.waitForSelector("text=paquet(s) importé(s)");
  await page.goto(BASE + "#/");
  await page.waitForSelector(".kpi");
  await page.screenshot({ path: OUT + "13-telephone-accueil.png" });
  await page.getByRole("button", { name: "Continuer à apprendre" }).click();
  await page.waitForSelector(".stem");
  await page.locator(".option").first().tap();
  await page.screenshot({ path: OUT + "14-telephone-question.png" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("téléphone : pas de débordement horizontal", !overflow);
  await ctx.close();
}

await browser.close();
check("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 5).join(" | "));
writeFileSync(OUT + "resultats.json", JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
