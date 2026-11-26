# Psycho 304 — Format d'import des contenus pédagogiques (v1.0.0)

Ce document est destiné à **ChatGPT**, responsable de la production pédagogique. Il décrit le format exact des fichiers JSON que l'application Psycho 304 sait importer.

Fichiers fournis avec ce document :

| Fichier | Rôle |
|---|---|
| `psycho304-content.schema.json` | Schéma JSON (draft 2020-12). Fait foi en cas de doute. |
| `exemple-paquet.json` | Exemple complet et valide. Tous les textes sont fictifs (`[EXEMPLE]`) et indiquent ce qu'il faut écrire. |
| `valider_paquet.py` | Validateur : `python3 valider_paquet.py paquet.json`. À exécuter avant chaque livraison. |

---

## 1. Principes

1. **Un fichier = un « paquet »** (`pack`). Toutes les sections sont facultatives : un paquet peut ne contenir que les questions d'un module.
2. **Découpage recommandé** : un paquet « structure » (parties, modules, sources), puis **un paquet par module** contenant ses notions, son cours et ses questions (ex. `p1-m07`).
3. **L'import fusionne par identifiant et ne supprime jamais rien.** Un élément absent d'un nouveau paquet reste dans l'application. Pour retirer un élément : le renvoyer avec `"review_status": "retired"`.
4. **Les identifiants sont permanents.** Ne jamais réutiliser un identifiant pour un autre contenu, ne jamais renuméroter. La progression de l'étudiant est rattachée aux identifiants.
5. **Toute modification d'une question ou d'un cours incrémente `version`** (et, pour une question, ajouter `revision_note`). Une version inférieure ou égale à celle déjà importée est ignorée (sauf contenu identique).
6. **Seules les questions `"review_status": "validated"`** apparaissent dans les sessions normales.
7. **Ne rien inventer** : chaque notion et chaque question cite une source universitaire précise (`source_id` + `location`). Si l'emplacement exact est inconnu, écrire `"location": "non localisé"` et laisser la notion en `"verification_status": "to_verify"`.
8. Encodage UTF-8, guillemets droits `"` pour le JSON ; les guillemets français « » sont autorisés dans les textes.

## 2. Structure générale

```json
{
  "format": "psycho304-content",
  "format_version": "1.0.0",
  "pack": { … },
  "sources": [ … ],
  "parts": [ … ],
  "modules": [ … ],
  "concepts": [ … ],
  "courses": [ … ],
  "questions": [ … ]
}
```

Aucun champ non prévu par le schéma n'est accepté (`additionalProperties: false`) : une faute de frappe dans un nom de champ provoque un refus.

## 3. Conventions d'identifiants

| Élément | Motif | Exemples |
|---|---|---|
| Partie | `P<n>` | `P1`, `P2` (`P0` réservé à la démo technique) |
| Module | `P<n>-M<nn>` (numéro **global** sur 2 chiffres) | `P1-M01` … `P1-M07`, `P2-M08` … `P2-M14` |
| Notion | `<module>-C<nnn>` | `P1-M07-C014` |
| Question | `<module>-Q<nnn>` (ou 4 chiffres) | `P1-M07-Q001` |
| Cours | `<module>-COURS` | `P1-M07-COURS` |
| Sous-partie de cours | `<module>-S<nn>` | `P1-M07-S03` |
| Source | majuscules, chiffres, tirets | `P1-CM5`, `P1-TD3`, `P2-TD5`, `ART-FREUD-1915`, `LIV-AUTEUR-2010` |
| Paquet | minuscules, chiffres, tirets | `structure`, `p1-m07`, `p2-m11-questions-lot2` |

Le préfixe d'une notion, d'une question, d'un cours ou d'une sous-partie **doit** correspondre à son `module_id`.

Architecture actuelle (provisoire, extensible sans modifier l'application) :

| Partie | Modules |
|---|---|
| `P1` Psychologie clinique et psychopathologie psychanalytique | `P1-M01` Histoire et fondements de la psychologie clinique · `P1-M02` Métapsychologie freudienne · `P1-M03` Clinique psychanalytique du symptôme · `P1-M04` Traumatisme et causalité psychique · `P1-M05` Psychopathologie et structures de personnalité · `P1-M06` Névroses et formes pathologiques · `P1-M07` Psychoses et formes pathologiques |
| `P2` Psychopathologie multidimensionnelle | `P2-M08` Modèles explicatifs de la psychopathologie · `P2-M09` Modèle biopsychosocial · `P2-M10` Facteurs de risque, de protection et vulnérabilité-stress · `P2-M11` Méthodes d'évaluation clinique, entretiens, tests et anamnèse · `P2-M12` Diagnostic et annonce diagnostique · `P2-M13` Psychoéducation · `P2-M14` Psychopathologie développementale |

Un nouveau module s'ajoute simplement avec un nouvel identifiant (ex. `P2-M15`).

## 4. `pack` — métadonnées de version (obligatoire)

| Champ | Obligatoire | Description |
|---|---|---|
| `id` | oui | Identifiant stable du paquet. |
| `title` | oui | Titre lisible. |
| `version` | oui | Entier ≥ 1, incrémenté à chaque nouvelle livraison du même paquet. |
| `kind` | oui | `content` (vrais contenus) · `demo` (données fictives, identifiants `P0` uniquement) · `example` (illustration du format, **refusé à l'import**). |
| `generated_at` | oui | Date ISO, ex. `2026-11-26`. |
| `generator` | non | Ex. `ChatGPT`. |
| `description` | non | Périmètre du paquet. |
| `changelog` | non | Liste `{version, date, changes}`. |

## 5. `sources` — documents universitaires

| Champ | Obligatoire | Description |
|---|---|---|
| `id` | oui | Voir conventions. |
| `kind` | oui | `CM`, `TD`, `article`, `book`, `other`. |
| `title` | oui | Intitulé exact du document. |
| `integration_status` | oui | `integrated` (entièrement exploité), `partial` (en cours), `pending` (disponible, non traité), `unavailable` (pas encore fourni, ex. TD 5 de la partie 2). |
| `part_id`, `number` | non | Ex. `P1`, `5`. |
| `authors`, `year`, `file_name`, `url` | non | Pour retrouver le document. |
| `location_unit` | non | `diapositive`, `page`, `paragraphe`, `autre`. |
| `notes` | non | Ex. « pages 7 à 10 restant à traiter ». |

Les sources `pending`, `partial` et `unavailable` alimentent la liste « contenus universitaires restant à intégrer ».

## 6. `parts` et `modules`

`parts` : `id`, `title`, `order` (obligatoires), `description`.

`modules` : `id`, `part_id`, `number` (= numéro dans l'identifiant), `title` (obligatoires), `description`, `source_ids` (CM/TD rattachés), `status` (`active` ou `planned`).

## 7. `concepts` — registre des notions (contrôle de couverture)

C'est le **registre indépendant des notions du programme**. Chaque connaissance évaluable doit y figurer, **y compris celles qui paraissent secondaires**.

| Champ | Obligatoire | Description |
|---|---|---|
| `id`, `module_id`, `title` | oui | |
| `sources` | oui | Au moins une référence `{source_id, location}` (document + diapositive/page). |
| `assessment` | oui | `evaluated`, `not_evaluated`, `to_confirm`. **Dans le doute : `to_confirm`**, jamais `not_evaluated`. |
| `verification_status` | oui | `verified`, `to_verify`, `disputed` (exactitude et localisation contrôlées contre la source). |
| `summary` | recommandé | Définition courte (1 à 3 phrases), affichée dans les corrections et le carnet d'erreurs. |
| `importance` | non | `core`, `standard`, `detail` (sert à l'affichage, n'exclut rien). |
| `authors`, `keywords` | non | |
| `confusable_with` | recommandé | Notions souvent confondues avec celle-ci (alimente le mode erreurs). |
| `prerequisites` | non | Notions à connaître d'abord. |
| `version`, `notes` | non | |

L'application calcule elle-même : présence d'une explication (une sous-partie de cours cite la notion), nombre de questions associées, notions sans question.

## 8. `courses` — cours condensés

Un seul cours par module (`<module>-COURS`), découpé en sous-parties.

| Champ | Obligatoire | Description |
|---|---|---|
| `id`, `module_id`, `title` | oui | |
| `review_status`, `version` | oui | Comme pour les questions. |
| `introduction` | non | |
| `sections` | oui | Liste de sous-parties. |

Sous-partie (`section`) : `id`, `title`, `concept_ids` (notions expliquées — **c'est ce lien qui permet de renvoyer l'étudiant au bon passage après une erreur**), `sources` (facultatif), `blocks`.

### Types de blocs

| `type` | Champs | Usage |
|---|---|---|
| `text` | `text` | Paragraphe. Mise en forme autorisée : `**gras**`, `*italique*`, lignes commençant par `- ` (liste) ou `1. ` (liste numérotée), sauts de ligne `\n`. |
| `key_point` | `text` | Concept essentiel, mis en évidence. |
| `definition` | `term`, `definition`, `concept_id`?, `author`?, `source`? | Définition consultable (index des définitions). |
| `table` | `columns` (≥ 2), `rows` (chaque ligne a autant de cellules que de colonnes), `title`?, `caption`? | Tableau comparatif. |
| `diagram` | `kind: "flow"` + `steps: [{label, detail?}]` (≥ 2) | Schéma en étapes successives. |
| `diagram` | `kind: "tree"` + `root: {label, detail?, children: [...]}` | Classification hiérarchique. |
| `author` | `name`, `contribution`, `dates`?, `key_works: [{title, year?}]`?, `concept_ids`? | Fiche auteur (index des auteurs). |
| `example` | `text`, `title`? | Illustration, cas clinique. |
| `pitfall` | `text`, `concept_ids`? | Piège fréquent / confusion à éviter. |

## 9. `questions`

| Champ | Obligatoire | Description |
|---|---|---|
| `id`, `module_id` | oui | |
| `concept_ids` | oui | ≥ 1 notion ; **la première est la notion principale** (suivi de maîtrise). |
| `type` | oui | Format de réponse : `single_choice`, `multiple_choice`, `true_false`. |
| `category` | oui | Nature : `knowledge`, `definition`, `distinction`, `author_date`, `application`, `clinical_vignette`. |
| `difficulty` | oui | `basic`, `intermediate`, `advanced`. |
| `vignette` | si `clinical_vignette` | Texte de la situation clinique. |
| `question` | oui | Énoncé. |
| `options` | oui | `{id, text, confusion_concept_id?}`. Identifiants `a` à `h` dans l'ordre ; pour `true_false`, exactement `vrai` et `faux`. |
| `correct_option_ids` | oui | `single_choice` : exactement 1 · `multiple_choice` : 1 ou plus · `true_false` : `["vrai"]` ou `["faux"]`. |
| `shuffle_options` | non (défaut `true`) | `false` si l'ordre compte (« Aucune des propositions ci-dessus ») ; **obligatoirement `false` pour `true_false`**. |
| `explanation` | oui | Correction détaillée. |
| `option_explanations` | oui | **Une justification pour chaque proposition**, justes comprises (clés = identifiants des propositions). |
| `sources` | oui | ≥ 1 `{source_id, location}` précis. |
| `course_section_ids` | non | Sous-parties à relire en cas d'erreur (sinon déduites des notions). |
| `variant_group` | recommandé | Même valeur pour les reformulations d'une même question (ex. `P1-M07-V001`). L'application ne les pose pas dans la même session et exige des réussites sur des formulations différentes. |
| `tags` | non | |
| `review_status` | oui | `draft`, `to_review`, `validated`, `needs_revision`, `retired`. |
| `version` | oui | Entier ≥ 1. |
| `revision_note` | si `version` > 1 | Ce qui a changé. |

### `confusion_concept_id`

Sur une **proposition incorrecte**, indique la notion que l'étudiant confond s'il la choisit (ex. choisir la définition de B quand on demande A). Jamais sur une bonne réponse. C'est ce qui permet au carnet d'erreurs d'identifier les confusions conceptuelles.

### Règles de qualité attendues

- Proposer **plusieurs questions par notion**, avec des formulations et des catégories différentes (définition, distinction, application, vignette), regroupées par `variant_group` lorsqu'il s'agit de reformulations directes.
- Distracteurs plausibles, de longueur comparable à la bonne réponse, sans indice grammatical.
- Éviter « toutes les propositions sont justes » sauf nécessité (et alors `shuffle_options: false`).
- Les questions dont la notion n'est pas `verified` restent en `to_review`.

## 10. Comportement de l'application à l'import

| Situation | Résultat |
|---|---|
| JSON illisible, non conforme au schéma, ou incohérence bloquante | Paquet **entièrement refusé**, rapport d'erreurs détaillé, rien n'est modifié. |
| Nouvel identifiant | Ajouté. |
| Identifiant existant, `version` supérieure | Mis à jour ; l'ancienne version est archivée ; la progression est conservée. Si l'énoncé, les propositions ou les bonnes réponses changent, la question est signalée « à revérifier ». |
| Identifiant existant, même `version`, contenu identique | Ignoré silencieusement. |
| Identifiant existant, même `version`, contenu différent | Refusé (avertissement : incrémenter `version`). |
| Identifiant existant, `version` inférieure | Ignoré (avertissement). |
| Référence vers un élément ni dans le paquet ni dans l'application | Erreur (notion, module, partie) ou avertissement (source, sous-partie). |
| `pack.kind = "example"` | Refusé. |

## 11. Liste de contrôle avant livraison

1. `python3 valider_paquet.py paquet.json` → **0 erreur**.
2. Chaque notion du document source figure dans `concepts`, avec sa localisation.
3. Chaque notion `evaluated` ou `to_confirm` a au moins une question (idéalement 3 ou plus).
4. Chaque question a une justification pour chaque proposition et au moins une source précise.
5. Toute question modifiée a une `version` incrémentée et une `revision_note`.
6. `pack.version` incrémenté si le paquet a déjà été livré.

## 12. Consigne type à transmettre à ChatGPT

> Tu produis les contenus pédagogiques de l'application Psycho 304 au format décrit dans `FORMAT_CONTENUS.md` et `psycho304-content.schema.json` (format 1.0.0). Pour le document universitaire que je te fournis, produis un paquet JSON `kind: "content"` pour le module indiqué contenant : (1) le registre exhaustif des notions avec leur localisation exacte, (2) le cours condensé découpé en sous-parties reliées aux notions, (3) les questions. N'invente aucune information absente des sources ; signale les incertitudes avec `to_confirm` / `to_verify`. Exécute `valider_paquet.py` sur ton fichier et corrige toutes les erreurs avant de me le livrer.
