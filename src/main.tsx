import React from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider } from "./ui/store";
import { App } from "./ui/app";
import { loadAll } from "./db/repo";
import { seedBundled } from "./db/seed";

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  try {
    let data = await loadAll();
    // Contenus de base intégrés : réinstallés automatiquement s'ils manquent
    const seed = await seedBundled(data);
    (window as any).__psycho304Seed = seed;
    if (seed.errors.length) console.warn("Contenus intégrés :", seed.errors);
    if (seed.imported.length) data = await loadAll();
    root.render(
      <StoreProvider initial={data}>
        <App />
      </StoreProvider>,
    );
  } catch (e) {
    root.render(
      <div style={{ padding: 32, maxWidth: 640, margin: "0 auto" }}>
        <h1>Impossible d'ouvrir la base locale</h1>
        <p>{(e as Error).message}</p>
        <p>Vérifiez que la navigation privée est désactivée et que le navigateur autorise le stockage local.</p>
      </div>,
    );
  }
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
