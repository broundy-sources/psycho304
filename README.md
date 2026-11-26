# Psycho 304 — application de révision (lot 1)

Application web installable (PWA) pour réviser l'UE 304 : cours condensés, QCM avec corrections détaillées, suivi de progression, import des contenus produits par ChatGPT. Fonctionne hors ligne ; les données restent sur l'appareil.

> Installation sur Windows / iPhone / iPad, synchronisation et sauvegardes : voir **`docs/INSTALLATION.md`**.

## Démarrage rapide

Le dossier `dist/` est déjà construit : c'est un site statique.

**Essayer en local** (nécessite [Bun](https://bun.sh)) :

```bash
bun run serve          # http://localhost:5173
```

Sans Bun, n'importe quel serveur statique fonctionne : `python3 -m http.server 5173 -d dist`.

**Mettre en ligne gratuitement (URL HTTPS, nécessaire pour l'installation sur iPad)** — au choix :

- **Netlify Drop** : glisser le dossier `dist/` sur app.netlify.com/drop.
- **Cloudflare Pages** : Workers & Pages → Create → Pages → *Upload assets* → déposer `dist/`.
- **GitHub Pages** : publier le contenu de `dist/` sur une branche `gh-pages`.

**Installer sur iPad / iPhone** : ouvrir l'URL dans Safari → Partager → *Sur l'écran d'accueil*. Sur Android / Windows (Chrome, Edge) : icône « Installer » de la barre d'adresse.

> Important sur iPad : utiliser l'application **installée** (écran d'accueil). Safari peut effacer les données d'un site simplement visité et non utilisé pendant plusieurs jours ; une PWA installée est protégée.

## Développement

```bash
bun run build          # construit dist/
bun run dev            # reconstruit à chaque modification
bun run test           # tests du noyau et des synchronisations (51 tests)
bun run typecheck      # vérification TypeScript du noyau
bun run serve &
node tests/ui/ui-check.mjs                  # parcours complet (17 vérifications)
TEST_UPDATE=1 node tests/ui/offline-check.mjs  # hors ligne + mise à jour (15 vérifications)
node tests/ui/sync-check.mjs                # sauvegarde GitHub, 2 appareils (18 vérifications)
node tests/ui/supabase-check.mjs            # compte Supabase : migration, 2 appareils, hors ligne, sessions (24 vérifications)
# Schéma SQL sur un PostgreSQL local : supabase/tests/ (stub Supabase + 14 tests RLS/déclencheurs)
OWNER=<pseudo> scripts/deploy-github.sh     # publication GitHub Pages + dépôt privé de données
```

Architecture : voir `docs/ARCHITECTURE.md`.

## Procédure d'importation des cours et questions

1. Transmettre à ChatGPT les 4 fichiers de `contenu-format/` (également téléchargeables depuis l'écran *Contenus* de l'application). La section 12 de `FORMAT_CONTENUS.md` contient une consigne prête à l'emploi.
2. Ordre conseillé : un paquet « structure » (parties, modules, sources), puis un paquet par module.
3. ChatGPT exécute `valider_paquet.py` sur chaque fichier avant de le livrer (0 erreur exigée).
4. Dans l'application : *Gestion des contenus* → *Choisir des fichiers* (plusieurs fichiers possibles, traités par ordre alphabétique) → lire le rapport → *Importer*.
   - Un fichier contenant une seule erreur est **entièrement refusé** ; rien n'est modifié.
   - Les avertissements n'empêchent pas l'import.
5. Corriger une question : ChatGPT renvoie la question avec le **même identifiant** et une `version` supérieure. L'ancienne version est archivée, la progression conservée, et la question apparaît dans « Questions corrigées à revérifier » si l'énoncé ou les réponses ont changé.
6. Seules les questions `validated` sont posées. Retirer une question : la renvoyer avec `review_status: "retired"`.

## Procédure de sauvegarde et restauration

- **Exporter** : *Gestion des contenus* → *Exporter la sauvegarde* → fichier `psycho304-sauvegarde-AAAA-MM-JJ.json` (contenus, paquets, réponses, sessions, réglages).
- **Restaurer / transférer vers un autre appareil** : déposer ce fichier dans la zone d'import de l'autre appareil → *Importer*. La restauration **fusionne** : elle ajoute ce qui manque, ne supprime rien, ne crée pas de doublon (on peut restaurer plusieurs fois sans risque).
- Conseil : exporter une sauvegarde une fois par semaine en attendant la synchronisation automatique.
- *Réinitialiser l'application* (zone sensible) demande de taper EFFACER et propose d'exporter avant.

## Données de démonstration

*Gestion des contenus* → *Charger les données de démonstration* : contenus fictifs de culture générale (partie P0), sans rapport avec l'UE 304, pour essayer l'application. *Supprimer les données de démonstration* les retire avec la progression associée, sans toucher aux vrais contenus.

## État des lots

| Lot | Contenu | État |
|---|---|---|
| 1 | Format d'import, tableau de bord, cours, QCM (unique / multiple / vrai-faux, mélange, barèmes, certitude), corrections avec renvoi au cours, erreurs à refaire, import JSON validé, sauvegarde locale, export/restauration, PWA hors ligne | **livré** |
| 1 bis | Hébergement GitHub Pages ; compte personnel Supabase (e-mail + mot de passe) ; synchronisation automatique et incrémentale des modules, réponses, sessions et réglages ; migration des données locales ; GitHub en sauvegarde facultative | **livré** — configuration : `docs/SUPABASE.md` |
| 2 | Niveaux de maîtrise par notion, répétition espacée, révision du jour, consolidation, carnet d'erreurs complet | |
| 3 | Partiels blancs, statistiques détaillées, contrôle de couverture complet | |
| 4 | Finitions iPad, documentation finale | |

Écarts techniques par rapport au cahier des charges : Bun remplace Vite et le CSS natif remplace Tailwind (l'environnement de développement n'avait pas d'accès réseau pour les installer). Le résultat est identique pour l'utilisateur : un site statique React + TypeScript.
