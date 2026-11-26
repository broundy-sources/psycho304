// Build de production : bun scripts/build.ts  →  dist/ (site statique prêt à héberger)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, watch } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

async function build() {
  const t0 = performance.now();
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync(join(root, "public"), dist, { recursive: true });
  // Le format d'import est livré avec l'application (téléchargeable depuis l'interface)
  cpSync(join(root, "contenu-format"), join(dist, "format"), { recursive: true });

  const res = await Bun.build({
    entrypoints: [join(root, "src/main.tsx")],
    outdir: dist,
    naming: "app.[ext]",
    target: "browser",
    minify: true,
    sourcemap: "none",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!res.success) {
    for (const l of res.logs) console.error(l);
    throw new Error("Échec du build");
  }
  writeFileSync(join(dist, "app.css"), readFileSync(join(root, "src/ui/styles.css"), "utf8"));

  const id = Date.now().toString(36);
  const html = readFileSync(join(dist, "index.html"), "utf8").replaceAll("__BUILD__", id);
  writeFileSync(join(dist, "index.html"), html);

  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push("./" + relative(dist, p).replaceAll("\\", "/"));
    }
  };
  walk(dist);
  const assets = ["./", ...files.filter((f) => !f.startsWith("./format/") && f !== "./sw.js").map((f) => (f === "./app.js" || f === "./app.css" ? `${f}?v=${id}` : f))];
  const sw = readFileSync(join(root, "scripts/sw.template.js"), "utf8").replace("__BUILD__", id).replace("__ASSETS__", JSON.stringify(assets, null, 2));
  writeFileSync(join(dist, "sw.js"), sw);
  console.log(`dist/ prêt en ${Math.round(performance.now() - t0)} ms (build ${id}, ${files.length} fichiers)`);
}

await build();
if (process.argv.includes("--watch")) {
  console.log("Surveillance de src/ …");
  let timer: ReturnType<typeof setTimeout> | null = null;
  for (const dir of ["src", "public", "contenu-format"]) {
    if (!existsSync(join(root, dir))) continue;
    watch(join(root, dir), { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => build().catch((e) => console.error(e.message)), 150);
    });
  }
}
