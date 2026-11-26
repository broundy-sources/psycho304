#!/usr/bin/env python3
"""
Validateur des paquets de contenus Psycho 304 (format 1.0.0).

Usage :  python3 valider_paquet.py mon-paquet.json [autre-paquet.json ...]

1. Validation structurelle avec le schéma JSON (si le module `jsonschema` est installé).
2. Contrôles de cohérence identiques à ceux de l'application (identifiants, références,
   bonnes réponses, justifications, etc.).

Code de sortie : 0 si aucune ERREUR (les AVERTISSEMENTS n'empêchent pas l'import).
Plusieurs fichiers passés ensemble sont contrôlés comme un ensemble (références croisées).
"""
import json
import re
import sys
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("psycho304-content.schema.json")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def schema_errors(data):
    try:
        import jsonschema
    except ImportError:
        return None
    schema = load(SCHEMA_PATH)
    v = jsonschema.Draft202012Validator(schema)
    out = []
    for e in sorted(v.iter_errors(data), key=lambda e: list(e.absolute_path)):
        loc = "/".join(str(p) for p in e.absolute_path) or "(racine)"
        out.append(f"{loc} : {e.message}")
    return out


def semantic_checks(packs):
    errors, warnings = [], []
    E, W = errors.append, warnings.append

    def mod_prefix(i):
        m = re.match(r"^(P[0-9]-M[0-9]{2})", i or "")
        return m.group(1) if m else None

    coll = {k: {} for k in ("sources", "parts", "modules", "concepts", "courses", "questions")}
    sections = {}
    for name, data in packs:
        kind = data.get("pack", {}).get("kind")
        for key in coll:
            for item in data.get(key, []) or []:
                iid = item.get("id")
                if iid in coll[key]:
                    E(f"[{name}] identifiant dupliqué dans {key} : {iid}")
                coll[key][iid] = item
                if kind == "demo" and key != "sources" and not str(iid).startswith("P0"):
                    E(f"[{name}] paquet demo : {iid} doit utiliser la partie P0")
                if kind == "content" and str(iid).startswith("P0"):
                    E(f"[{name}] paquet content : {iid} utilise P0, réservé à la démonstration")
        if kind == "example":
            W(f"[{name}] kind = example : ce fichier sera refusé par l'application (illustration du format)")

    for c in coll["courses"].values():
        if mod_prefix(c["id"]) != c.get("module_id"):
            E(f"cours {c['id']} : le préfixe ne correspond pas à module_id {c.get('module_id')}")
        for s in c.get("sections", []):
            if s["id"] in sections:
                E(f"sous-partie dupliquée : {s['id']}")
            sections[s["id"]] = s
            if mod_prefix(s["id"]) != c.get("module_id"):
                E(f"sous-partie {s['id']} : préfixe différent du module du cours {c.get('module_id')}")

    def need(kind_label, ref, pool, ctx):
        if ref not in pool:
            W(f"{ctx} : {kind_label} {ref} absent(e) de ce lot — doit déjà exister dans l'application")

    for m in coll["modules"].values():
        if not m["id"].startswith(m.get("part_id", "?") + "-"):
            E(f"module {m['id']} : préfixe incohérent avec part_id {m.get('part_id')}")
        if int(m["id"][-2:]) != m.get("number"):
            E(f"module {m['id']} : number {m.get('number')} ne correspond pas à l'identifiant")
        need("partie", m.get("part_id"), coll["parts"], f"module {m['id']}")
        for sid in m.get("source_ids", []):
            need("source", sid, coll["sources"], f"module {m['id']}")

    for c in coll["concepts"].values():
        if mod_prefix(c["id"]) != c.get("module_id"):
            E(f"notion {c['id']} : préfixe incohérent avec module_id {c.get('module_id')}")
        need("module", c.get("module_id"), coll["modules"], f"notion {c['id']}")
        for s in c.get("sources", []):
            need("source", s.get("source_id"), coll["sources"], f"notion {c['id']}")
        for other in c.get("confusable_with", []) + c.get("prerequisites", []):
            if other == c["id"]:
                E(f"notion {c['id']} : se référence elle-même")
            need("notion", other, coll["concepts"], f"notion {c['id']}")

    for s in sections.values():
        for cid in s.get("concept_ids", []):
            need("notion", cid, coll["concepts"], f"sous-partie {s['id']}")
        for b in s.get("blocks", []):
            if b.get("type") == "table":
                n = len(b.get("columns", []))
                for r in b.get("rows", []):
                    if len(r) != n:
                        E(f"sous-partie {s['id']} : ligne de tableau avec {len(r)} cellules au lieu de {n}")

    question_concepts = set()
    for q in coll["questions"].values():
        ctx = f"question {q['id']}"
        if mod_prefix(q["id"]) != q.get("module_id"):
            E(f"{ctx} : préfixe incohérent avec module_id {q.get('module_id')}")
        need("module", q.get("module_id"), coll["modules"], ctx)
        opt_ids = [o["id"] for o in q.get("options", [])]
        if len(set(opt_ids)) != len(opt_ids):
            E(f"{ctx} : identifiants de propositions dupliqués")
        correct = q.get("correct_option_ids", [])
        for cid in correct:
            if cid not in opt_ids:
                E(f"{ctx} : bonne réponse « {cid} » absente des propositions")
        if q.get("type") == "single_choice" and len(correct) != 1:
            E(f"{ctx} : single_choice exige exactement une bonne réponse")
        if q.get("type") == "multiple_choice" and len(correct) == len(opt_ids):
            W(f"{ctx} : toutes les propositions sont justes — vérifier")
        if q.get("type") != "true_false" and opt_ids != sorted(opt_ids):
            W(f"{ctx} : propositions non ordonnées (a, b, c…)")
        texts = [o["text"].strip().lower() for o in q.get("options", [])]
        if len(set(texts)) != len(texts):
            E(f"{ctx} : deux propositions ont le même texte")
        expl = set(q.get("option_explanations", {}).keys())
        if expl != set(opt_ids):
            missing = set(opt_ids) - expl
            extra = expl - set(opt_ids)
            if missing:
                E(f"{ctx} : justification manquante pour {sorted(missing)}")
            if extra:
                E(f"{ctx} : justification pour des propositions inexistantes {sorted(extra)}")
        for o in q.get("options", []):
            cc = o.get("confusion_concept_id")
            if cc:
                if o["id"] in correct:
                    E(f"{ctx} : confusion_concept_id sur une bonne réponse ({o['id']})")
                need("notion", cc, coll["concepts"], ctx)
        for cid in q.get("concept_ids", []):
            question_concepts.add(cid)
            need("notion", cid, coll["concepts"], ctx)
            c = coll["concepts"].get(cid)
            if c and q.get("review_status") == "validated" and c.get("verification_status") != "verified":
                W(f"{ctx} : validée alors que la notion {cid} n'est pas vérifiée")
        for s in q.get("sources", []):
            need("source", s.get("source_id"), coll["sources"], ctx)
        for sid in q.get("course_section_ids", []):
            if sid not in sections:
                W(f"{ctx} : sous-partie {sid} absente de ce lot")
        if q.get("version", 1) > 1 and not q.get("revision_note"):
            W(f"{ctx} : version > 1 sans revision_note")

    for cid, c in coll["concepts"].items():
        if cid not in question_concepts and c.get("assessment") != "not_evaluated":
            W(f"notion {cid} : aucune question dans ce lot")

    return errors, warnings


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    packs, fatal = [], False
    for p in argv[1:]:
        try:
            data = load(p)
        except Exception as ex:  # noqa: BLE001
            print(f"ERREUR [{p}] JSON illisible : {ex}")
            fatal = True
            continue
        se = schema_errors(data)
        if se is None:
            print("(module jsonschema absent : validation structurelle ignorée — pip install jsonschema)")
        elif se:
            fatal = True
            for e in se:
                print(f"ERREUR SCHÉMA [{p}] {e}")
        packs.append((Path(p).name, data))
    errors, warnings = semantic_checks(packs)
    for e in errors:
        print(f"ERREUR {e}")
    for w in warnings:
        print(f"AVERTISSEMENT {w}")
    n = {k: sum(len(d.get(k, []) or []) for _, d in packs) for k in ("concepts", "courses", "questions")}
    print(f"\nBilan : {n['concepts']} notions, {n['courses']} cours, {n['questions']} questions — "
          f"{len(errors)} erreur(s), {len(warnings)} avertissement(s).")
    return 1 if (errors or fatal) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
