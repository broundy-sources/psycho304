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
            Supabase (offre gratuite) — Auth e-mail/mot de passe
            Postgres + RLS : content_packs · attempts · sessions · settings
            (+ option : dépôt GitHub privé, copie versionnée)
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

## 4. Compte et synchronisation (Supabase, lot 1 bis)

Authentification e-mail + mot de passe (Supabase Auth, inscriptions publiques désactivées), jeton renouvelé automatiquement. API REST appelée par `fetch`, clé publique dans `apikey`, jeton utilisateur dans `Authorization`.

| Table | Contenu | Règle |
|---|---|---|
| `content_packs` | modules importés (paquet brut) | ajout seul, jamais écrasé |
| `attempts` | réponses | ajout seul, jamais modifié ni supprimé |
| `sessions` | sessions d'entraînement | la plus récente gagne (déclencheur) |
| `settings` | réglages | la plus récente gagne (déclencheur) |

Chaque écriture reçoit un numéro `row_seq` croissant : un appareil ne télécharge que les lignes postérieures à son dernier numéro connu (pagination jusqu'à page vide). Envoi : tout élément local non marqué « envoyé » (`_sb`), ce qui réalise aussi la migration initiale des données existantes. Sécurité : RLS `user_id = auth.uid()` sur toutes les tables.

Hors ligne : tout est écrit d'abord dans IndexedDB ; la synchronisation reprend au retour du réseau.

Option : copie supplémentaire dans un dépôt GitHub privé (fichier de progression par appareil, modules), conservée du lot précédent.

Contenus de base : les paquets de `public/content/` (structure du programme) sont livrés avec l'appli et installés à chaque démarrage s'ils manquent.

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
