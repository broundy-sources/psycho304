# Psycho 304 — Installation, synchronisation et sauvegarde

L'appli est publiée à une adresse fixe : **https://VOTRE-PSEUDO.github.io/psycho304/** (communiquée lors de la mise en ligne). On l'installe une fois sur chaque appareil ; elle s'ouvre ensuite depuis son icône, comme une appli classique, avec ou sans réseau.

## 1. Installer l'appli

**Windows (Edge ou Chrome)**
1. Ouvrir l'adresse.
2. Cliquer sur l'icône « Installer » à droite de la barre d'adresse (ou menu ⋯ → Applications → Installer Psycho 304).
3. L'appli apparaît dans le menu Démarrer ; clic droit → *Épingler à la barre des tâches*.

**iPhone et iPad (Safari obligatoire)**
1. Ouvrir l'adresse dans **Safari**.
2. Bouton Partager → *Sur l'écran d'accueil* → laisser *Ouvrir comme app web* activé → *Ajouter*.
3. Réviser **toujours depuis l'icône**. Sur iOS, l'appli installée et l'onglet Safari ont des données séparées.

Après la première ouverture, l'appli fonctionne hors ligne (cours, QCM, progression).

## 2. Contenus

- Les modules intégrés à l'appli (actuellement P1-M01) sont présents dès l'installation et réinstallés automatiquement s'ils manquaient.
- Nouveau module produit par ChatGPT : *Gestion des contenus* → *Choisir des fichiers* → *Importer*. Il est envoyé dans votre dépôt privé et arrive sur vos autres appareils à leur prochaine synchronisation.
- Pour qu'un module fasse partie des contenus de base de l'appli : le placer dans `public/content/`, l'ajouter à `public/content/index.json`, puis republier.

## 3. Activer la synchronisation (une fois par appareil)

La progression et les modules importés sont copiés dans un **dépôt GitHub privé** (`psycho304-donnees`). Chaque envoi est conservé dans l'historique du dépôt : c'est aussi votre sauvegarde distante.

1. **Créer le jeton d'accès (une seule fois)** : depuis l'appli, *Gestion des contenus* → *Créer un jeton (formulaire pré-rempli)*, ou sur github.com → Settings → Developer settings → Fine-grained tokens.
   - *Repository access* : **Only select repositories** → `psycho304-donnees`.
   - *Permissions* : **Contents : Read and write** (déjà rempli).
   - *Generate token*, puis copier le jeton (`github_pat_…`). Le ranger dans votre gestionnaire de mots de passe : GitHub ne le réaffiche pas.
2. **Dans l'appli, sur chaque appareil** : *Gestion des contenus* → *Synchronisation et sauvegarde distante* → dépôt `VOTRE-PSEUDO/psycho304-donnees`, coller le jeton, nommer l'appareil → *Connecter et synchroniser*.

La synchronisation se fait ensuite seule : à l'ouverture, toutes les 3 minutes, après chaque session, au retour du réseau et à la fermeture. Hors ligne, rien n'est perdu : l'envoi se fait au retour de la connexion.

Le jeton reste sur l'appareil (jamais dans les sauvegardes exportées). En cas de perte ou de vol d'un appareil : révoquer le jeton sur GitHub et en créer un nouveau.

## 4. Sauvegardes

| Sauvegarde | Fréquence | Contenu |
|---|---|---|
| Dépôt privé GitHub | automatique | progression complète de chaque appareil + modules importés, avec historique |
| Export local | manuel (conseillé : chaque semaine) | *Gestion des contenus* → *Exporter la sauvegarde* : contenus + progression dans un fichier JSON |

**Récupérer après une perte** (appareil changé, données du navigateur effacées) : réinstaller l'appli, activer la synchronisation avec le même dépôt → modules et progression reviennent. Sans synchronisation : déposer le fichier exporté dans la zone d'import.

## 5. À éviter

- La navigation privée.
- *Effacer les données du site* dans les réglages du navigateur (ou alors synchroniser avant).
- Ouvrir l'appli depuis une autre adresse que celle de l'installation : les données sont rattachées à l'adresse.

## 6. Mises à jour

Une nouvelle version publiée est récupérée automatiquement à l'ouverture suivante avec réseau. Les contenus et la progression ne sont jamais touchés par une mise à jour.
