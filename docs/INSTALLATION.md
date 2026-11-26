# Psycho 304 — Installation, synchronisation et sauvegarde

L'appli est publiée à une adresse fixe : **https://broundy-sources.github.io/psycho304/**. On l'installe une fois sur chaque appareil ; elle s'ouvre ensuite depuis son icône, comme une appli classique, avec ou sans réseau.

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

## 3. Compte et synchronisation (Supabase)

Configuration une seule fois : voir **`docs/SUPABASE.md`** (création du projet, des tables et du compte).
Ensuite, sur chaque appareil : *Gestion des contenus* → **Compte et synchronisation** → se connecter. Contenus, progression et historique de réponses sont alors identiques sur l'ordinateur, l'iPad et l'iPhone, avec fonctionnement hors ligne.

La copie dans un dépôt GitHub privé reste disponible en option (*Sauvegarde supplémentaire GitHub*).

## 4. Sauvegardes

| Sauvegarde | Fréquence | Contenu |
|---|---|---|
| Compte Supabase | automatique | modules importés, réponses, sessions, réglages |
| Dépôt privé GitHub (facultatif) | automatique si activé | copie versionnée de la progression et des modules |
| Export local | manuel (conseillé : chaque semaine) | *Gestion des contenus* → *Exporter la sauvegarde* : contenus + progression dans un fichier JSON |

**Récupérer après une perte** (appareil changé, données du navigateur effacées) : réinstaller l'appli et se reconnecter → modules, progression et historique reviennent. Sans synchronisation : déposer le fichier exporté dans la zone d'import.

## 5. À éviter

- La navigation privée.
- *Effacer les données du site* dans les réglages du navigateur (ou alors synchroniser avant).
- Ouvrir l'appli depuis une autre adresse que celle de l'installation : les données sont rattachées à l'adresse.

## 6. Mises à jour

Une nouvelle version publiée est récupérée automatiquement à l'ouverture suivante avec réseau. Les contenus et la progression ne sont jamais touchés par une mise à jour.
