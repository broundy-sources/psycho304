# Psycho 304 — Configurer Supabase (compte personnel + synchronisation)

Durée : 10 à 15 minutes, une seule fois. Rien n'est effacé sur tes appareils : à la première connexion, chaque appareil envoie ce qu'il contient, puis récupère ce que les autres ont envoyé.

## Étape 1 — Créer le projet

1. Aller sur supabase.com → *Start your project* → se connecter (GitHub ou e-mail).
2. *New project* :
   - **Name** : `psycho304`
   - **Database Password** : cliquer sur *Generate a password* et le ranger dans le gestionnaire de mots de passe (l'appli ne s'en sert pas, mais Supabase peut le redemander).
   - **Region** : *West EU (Paris)* (ou la plus proche).
   - Offre **Free**.
3. *Create new project*, puis attendre 1 à 2 minutes que le projet soit prêt.

## Étape 2 — Créer les tables

1. Menu de gauche : **SQL Editor** → *New query*.
2. Coller **tout** le contenu du fichier `supabase/schema.sql` (dépôt GitHub `psycho304`, branche `main`).
3. Cliquer sur **Run**. Résultat attendu : *Success. No rows returned*.
4. Vérification : **Table Editor** affiche `attempts`, `sessions`, `settings` et `content_packs`, avec un cadenas (sécurité par utilisateur activée).

Le script peut être relancé sans risque : il ne supprime aucune donnée.

## Étape 3 — Créer ton compte (et lui seul)

1. **Authentication** → **Users** → *Add user* → **Create new user**.
2. Saisir ton e-mail et un mot de passe solide ; **cocher *Auto Confirm User*** → *Create user*.
3. **Authentication** → **Sign In / Providers** (rubrique *User Signups*) : **désactiver *Allow new users to sign up*** → *Save*.
   Ainsi, personne d'autre ne peut créer de compte sur ton projet, même en connaissant son adresse.

## Étape 4 — Récupérer l'adresse et la clé publique

1. Bouton **Connect** en haut du tableau de bord du projet, ou **Project Settings** → **Data API** : copier la **Project URL** (`https://xxxxxxxx.supabase.co`).
2. **Project Settings** → **API Keys** : copier la **Publishable key** (`sb_publishable_…`).
   - Si l'onglet ne montre que des clés *legacy*, la clé **anon public** fonctionne aussi.
   - Ne jamais utiliser la clé **secret** / **service_role** dans l'appli.

Ces deux valeurs ne sont pas secrètes : la sécurité repose sur ton mot de passe et sur les règles créées à l'étape 2. Tu peux me les transmettre pour que je les intègre à l'appli ; tu n'auras alors plus qu'à saisir ton e-mail et ton mot de passe sur chaque appareil.

## Étape 5 — Migrer : commencer par l'appareil qui contient tes 14 modules

1. Ouvrir Psycho 304 (icône installée) sur l'appareil où les modules ont été importés.
2. *Gestion des contenus* → **Compte et synchronisation** → adresse du projet, clé publique, e-mail, mot de passe → **Se connecter**.
3. L'appli envoie tout ce qu'elle contient (modules importés, réponses, sessions, réglages) et affiche *Synchronisation terminée*.
4. Contrôle dans Supabase → **Table Editor** : `content_packs` contient une ligne par module importé ; `attempts` une ligne par réponse.

## Étape 6 — Connecter les autres appareils

Sur l'iPad, l'iPhone et tout autre appareil : ouvrir l'appli **depuis son icône** → *Gestion des contenus* → se connecter avec le même compte. Les 14 modules, la progression et l'historique arrivent automatiquement ; si cet appareil contenait aussi des réponses, elles sont ajoutées au compte, sans doublon.

## Fonctionnement au quotidien

- Synchronisation automatique : à l'ouverture, toutes les 3 minutes, après chaque session ou import, au retour du réseau et à la mise en arrière-plan. Bouton *Synchroniser maintenant* pour forcer.
- Hors ligne : tout continue de fonctionner ; les éléments *en attente d'envoi* partent au retour du réseau.
- Nouveau module produit par ChatGPT : l'importer sur un appareil ; les autres le reçoivent à leur synchronisation suivante.
- Réponses et modules ne sont jamais modifiés ni supprimés dans Supabase ; pour les sessions et les réglages, la version la plus récente l'emporte.
- *Se déconnecter* arrête la synchronisation sur l'appareil sans rien effacer.

## Sauvegardes

| Où | Comment |
|---|---|
| Supabase | automatique (base PostgreSQL de ton projet) |
| Local | *Exporter la sauvegarde* (fichier JSON complet) — conseillé chaque semaine avant le partiel |
| GitHub (facultatif) | *Sauvegarde supplémentaire GitHub* : copie versionnée en plus |

## À savoir sur l'offre gratuite

- Un projet gratuit **sans activité pendant 7 jours est mis en pause**. En révisant chaque jour, cela n'arrive pas. En cas de pause : bouton *Restore* dans le tableau de bord Supabase. Pendant une pause, l'appli fonctionne normalement hors ligne et synchronise dès la reprise.
- Quota : 500 Mo de base, soit bien plus que nécessaire (une réponse ≈ 1 Ko).

## En cas de problème

| Message dans l'appli | Solution |
|---|---|
| e-mail ou mot de passe incorrect | vérifier le compte créé à l'étape 3 |
| adresse e-mail non confirmée | recréer le compte en cochant *Auto Confirm User* |
| tables introuvables | relancer `schema.sql` (étape 2) |
| clé publique invalide | recopier la *Publishable key* (pas la clé secrète) |
| pas de connexion au serveur | hors ligne, adresse du projet incorrecte, ou projet en pause |
| session expirée : reconnectez-vous | se reconnecter ; aucune donnée n'est perdue |
