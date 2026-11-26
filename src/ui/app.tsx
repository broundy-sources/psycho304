import React from "react";
import { useStore } from "./store";
import { Icon } from "./components";
import { DashboardPage } from "./dashboard";
import { CoursesPage } from "./courses";
import { SessionPage, TrainingPage } from "./training";
import { ErrorsPage, ExamsPage, StatsPage } from "./misc";
import { ContentPage } from "./content";

const NAV = [
  { href: "/", icon: "home", label: "Tableau de bord", short: "Accueil" },
  { href: "/cours", icon: "book", label: "Mes cours", short: "Cours" },
  { href: "/entrainement", icon: "target", label: "Entraînement", short: "Entraîner" },
  { href: "/erreurs", icon: "alert", label: "Mes erreurs", short: "Erreurs" },
  { href: "/partiels", icon: "clipboard", label: "Partiels blancs", short: "Partiels" },
  { href: "/stats", icon: "chart", label: "Statistiques", short: "Stats" },
  { href: "/contenus", icon: "folder", label: "Gestion des contenus", short: "Contenus" },
];

export function App() {
  const { route, active, sync } = useStore();
  const [, first = "", second] = route.split("/");
  const page = (() => {
    switch (first) {
      case "":
        return <DashboardPage />;
      case "cours":
        return <CoursesPage moduleId={second} />;
      case "entrainement":
        return <TrainingPage />;
      case "session":
        return <SessionPage />;
      case "erreurs":
        return <ErrorsPage />;
      case "partiels":
        return <ExamsPage />;
      case "stats":
        return <StatsPage />;
      case "contenus":
        return <ContentPage />;
      default:
        return <DashboardPage />;
    }
  })();
  const isActive = (href: string) => (href === "/" ? first === "" : `/${first}` === href || (href === "/entrainement" && first === "session"));
  return (
    <div className="app">
      <nav className="nav" aria-label="Navigation principale">
        <div className="brand"><div className="brand-mark">304</div><span>Psycho 304</span></div>
        {NAV.map((n) => (
          <a key={n.href} href={`#${n.href === "/entrainement" && active && !active.record.ended_at ? "/session" : n.href}`} className={isActive(n.href) ? "active" : ""} aria-current={isActive(n.href) ? "page" : undefined}>
            <Icon name={n.icon} size={20} />
            <span className="lbl-long">{n.label}</span>
            <span className="lbl-short">{n.short}</span>
          </a>
        ))}
        <div className="nav-foot">
          {sync.configured
            ? sync.running ? "Synchronisation…" : sync.last_success ? `Synchronisé ${new Date(sync.last_success).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${sync.online ? "" : " · hors ligne"}` : "Synchronisation en attente"
            : "Données stockées sur cet appareil uniquement"}
        </div>
      </nav>
      <main className="main">{page}</main>
    </div>
  );
}
