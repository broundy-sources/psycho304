// Serveur local : bun scripts/serve.ts  →  http://localhost:5173
import { join, normalize } from "node:path";

const dist = join(import.meta.dir, "..", "dist");
const port = Number(process.env.PORT ?? 5173);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(join(dist, path));
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(join(dist, "index.html")));
  },
});
console.log(`Psycho 304 : http://localhost:${port}`);
