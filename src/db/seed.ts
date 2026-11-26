// Contenus de base intégrés à l'application (dossier public/content/).
// À chaque démarrage, tout paquet intégré pas encore installé (clé id@version) est importé.
// Conséquence : même si le stockage du navigateur est vidé, les contenus de base reviennent
// automatiquement. Rien n'est jamais supprimé ; une version plus récente déjà installée est conservée.

import { parsePackText, validatePack } from "../core/pack-validator";
import { applyPlan, packKey, planImport } from "../core/importer";
import { commitImport, type AppData } from "./repo";

export interface SeedReport { imported: string[]; errors: string[] }

export async function seedBundled(data: AppData, base = "./content/"): Promise<SeedReport> {
  const report: SeedReport = { imported: [], errors: [] };
  let index: { packs: string[] };
  try {
    const res = await fetch(base + "index.json");
    if (!res.ok) return report;
    index = await res.json();
  } catch {
    return report; // hors ligne sans cache : rien à faire
  }
  const installed = new Set(data.packs.map((p) => p.key));
  let content = data.content;
  for (const file of index.packs ?? []) {
    try {
      const res = await fetch(base + encodeURIComponent(file));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parsePackText(await res.text());
      if (parsed.error) throw new Error(parsed.error);
      const v = validatePack(parsed.data, content);
      if (!v.ok) {
        const first = v.issues.find((i) => i.level === "error");
        throw new Error(`paquet refusé (${first?.where} : ${first?.message})`);
      }
      const key = packKey(v.pack!);
      if (installed.has(key)) continue;
      const plan = planImport(content, v.pack!);
      await commitImport(v.pack!, plan, new Date().toISOString(), "bundled");
      content = applyPlan(content, plan);
      installed.add(key);
      report.imported.push(key);
    } catch (e) {
      report.errors.push(`${file} : ${(e as Error).message}`);
    }
  }
  return report;
}
