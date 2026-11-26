# Psycho 304 — Architecture technique

## 1. Vue d'ensemble

```
┌──────────────── Appareil (PC, iPad, téléphone) ────────────────┐
│  PWA (React + TypeScript), installable, hors ligne               │
│                                                                   │
│   Interface ──► Noyau métier (pur, testé)                         │
│                  · validation des paquets (schéma JSON)           │
│                  · fusion des contenus (import)                   │
│                  · moteur de QCM (mélange, notation, barèmes)     │
│                  · progression = rejeu du journal des réponses    │
│                         │                                         │
│                  IndexedDB (source de vérité locale)              │
│                  · contenus + historique des versions             │
│                  · journal des réponses (ajout seul)              │
│                  · sessions, réglages                             │
│                         │  synchronisation (au retour du réseau)  │
└─────────────────────────┼─────────────────────────────────────────┘
                          ▼
            Dépôt GitHub privé « psycho304-donnees » (API contents, jeton fine-grained)
            progression/<appareil>.json · contenus/<paquet>.json · historique git
```

Hébergement : fichiers statiques (`dist/`) sur Cloudflare Pages, Netlify ou GitHub Pages — gratuits, HTTPS fourni (obligatoire pour une PWA).

## 2. Principes

**Local d'abord.** Toute action s'enregistre immédiatement dans IndexedDB : l'application fonctionne sans réseau et sans compte. La synchronisation est une couche ajoutée, jamais un prérequis.

**Journal d'événements plutôt qu'état mutable.** Chaque réponse est un enregistrement immuable (`attempt`, identifiant UUID). La progression (statuts de maîtrise, échéances, carnet d'erreurs, statistiques) est **recalculée** en rejouant le journal. Conséquences :

- la synchronisation entre appareils se réduit à une **union d'ensembles** : aucun conflit possible, rien ne peut écraser une progression ;
- modifier les paramètres de l'algorithme de révision recalcule tout l'historique de façon cohérente ;
- une mise à jour de l'application ne touche jamais aux données (le journal est conservé tel quel ; seules les fonctions de calcul évoluent).

**Contenus synchronisés par leurs paquets.** Chaque fichier importé est conservé brut. Un autre appareil rejoue les mêmes imports dans le même ordre et obtient exactement le même état. La progression est attachée aux identifiants permanents, pas aux fichiers.

**Une seule source de vérité pour le format** : `contenu-format/psycho304-content.schema.json`, utilisé par l'application (validateur intégré) et par le script Python de ChatGPT.

## 3. Modèle de données local (IndexedDB `psycho304`)

| Magasin | Clé | Contenu |
|---|---|---|
| `sources`, `parts`, `modules`, `concepts`, `courses`, `questions` | `id` | Version courante de chaque élément + `_pack` (paquet d'origine) + `_needs_recheck`. |
| `history` | `[id, version]` | Versions antérieures archivées (questions, cours, notions). |
| `packs` | `key` (`id@version`) | Paquet brut importé, date, empreinte, rapport d'import. |
| `attempts` | `id` (UUID) | Réponse : question + version, notions, propositions choisies, ordre affiché, score, confiance (`guess`/`unsure`/`sure`), durée, mode, session, date, appareil, `_synced`. |
| `sessions` | `id` (UUID) | Mode, réglages, questions, début/fin, note, `updated_at`, `_synced`. |
| `settings` | `key` | Date d'examen, thème, barème, paramètres de révision ; `updated_at`. |
| `meta` | `key` | Identifiant d'appareil, version du schéma de base, curseurs de synchronisation. |

Les migrations de base sont versionnées (`onupgradeneeded`) et n'effacent jamais de magasin existant.

## 4. Synchronisation et sauvegarde distante (GitHub, lot 1 bis)

Choix révisé (26/11) : un dépôt GitHub privé plutôt que Supabase. Raisons : un seul compte (déjà utilisé pour l'hébergement), aucune mise en pause du service après une semaine d'inactivité, historique complet de chaque envoi (sauvegarde versionnée), aucune base de données à administrer.

| Fichier distant | Écrit par | Fusion |
|---|---|---|
| `progression/<id-appareil>.json` | uniquement l'appareil concerné (aucun conflit d'écriture) | union des réponses par identifiant ; sessions et réglages : la plus récente gagne |
| `contenus/<paquet>.json` | l'appareil où le paquet a été importé à la main | importé ailleurs dans l'ordre d'import, avec les mêmes règles qu'un import manuel |

Chaque fichier de progression contient toute la progression connue de l'appareil : un seul fichier suffit à tout restaurer. Une écriture n'a lieu que si le contenu a changé.

Cycle : à l'ouverture, toutes les 3 minutes (appli visible), à la fin d'une session, après un import ou un réglage, au retour du réseau et quand l'appli passe en arrière-plan.

Contenus de base : les paquets de `public/content/` sont livrés avec l'appli et installés à chaque démarrage s'ils manquent (clé `id@version`).

Sauvegarde de secours indépendante : export JSON complet, réimportable par fusion.

## 5. Pile technique

| Élément | Choix | Remarque |
|---|---|---|
| Interface | React 19 + TypeScript | |
| Build / tests | Bun (`bun build`, `bun test`) | Remplace Vite : l'environnement de développement n'avait pas d'accès réseau pour installer Vite. Le résultat (`dist/`) est un site statique standard. |
| Styles | CSS natif à variables (thèmes sombre/clair) | Remplace Tailwind pour la même raison ; aucune dépendance. |
| Stockage | IndexedDB (API native, petite surcouche) | |
| Hors ligne | Service worker (cache de l'application) + manifeste PWA | |
| Synchronisation | API REST Supabase via `fetch` | Pas de `supabase-js` nécessaire. |

## 6. Organisation du code

```
contenu-format/         format d'import (schéma, doc, exemple, validateur Python)
src/core/               noyau pur, sans navigateur — entièrement testé
  schema-validator.ts   validateur JSON Schema (sous-ensemble 2020-12) en français
  pack-validator.ts     schéma + contrôles de cohérence (mêmes règles que le script Python)
  importer.ts           plan de fusion d'un paquet (ajouts, mises à jour, refus)
  qcm.ts                mélange, notation, barèmes, construction des sessions
  progress.ts           rejeu du journal → indicateurs
src/db/                 IndexedDB, sauvegarde/restauration
src/ui/                 écrans React
public/                 manifeste, service worker, icônes, paquet de démonstration
tests/                  tests automatisés (données fictives P0 uniquement)
```

## 7. Feuille de route

| Lot | Contenu | État |
|---|---|---|
| 1 | Format d'import, noyau, QCM et corrections, import JSON, stockage local, tableau de bord, cours, sauvegarde, PWA | ce livrable |
| 1 bis | Compte + synchronisation Supabase | suivant |
| 2 | Suivi par notion, répétition espacée, niveaux de maîtrise, carnet d'erreurs complet, révision quotidienne | |
| 3 | Partiels blancs, statistiques détaillées, contrôle de couverture complet | |
| 4 | Finitions iPad, documentation, corrections | |
