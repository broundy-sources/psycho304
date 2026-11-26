// Validateur JSON Schema minimal (sous-ensemble de la draft 2020-12 utilisé par le format
// Psycho 304), avec messages en français. Aucune dépendance.

export interface SchemaError { path: string; message: string }

type Schema = Record<string, any> | boolean;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

const TYPE_FR: Record<string, string> = {
  string: "texte",
  integer: "entier",
  number: "nombre",
  boolean: "booléen",
  object: "objet",
  array: "liste",
  null: "null",
};

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fmt(v: unknown): string {
  const s = JSON.stringify(v);
  return s && s.length > 60 ? s.slice(0, 57) + "…" : String(s);
}

export class SchemaValidator {
  constructor(private root: Record<string, any>) {}

  validate(value: unknown): SchemaError[] {
    const errors: SchemaError[] = [];
    this.check(this.root, value, "", errors);
    return errors;
  }

  private resolve(ref: string): Schema {
    if (!ref.startsWith("#/")) throw new Error(`Référence non prise en charge : ${ref}`);
    let node: any = this.root;
    for (const part of ref.slice(2).split("/")) node = node?.[part];
    if (node === undefined) throw new Error(`Référence introuvable : ${ref}`);
    return node;
  }

  private check(schema: Schema, v: unknown, path: string, errors: SchemaError[]): void {
    if (schema === true) return;
    if (schema === false) {
      errors.push({ path, message: "valeur non autorisée" });
      return;
    }
    const s = schema;
    const at = path || "(racine)";
    const push = (message: string) => errors.push({ path: at, message });

    if (s.$ref) this.check(this.resolve(s.$ref), v, path, errors);

    if (s.type !== undefined) {
      const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
      const t = typeOf(v);
      const ok = types.some((x) => x === t || (x === "number" && t === "integer"));
      if (!ok) {
        push(`type attendu : ${types.map((x) => TYPE_FR[x] ?? x).join(" ou ")} (reçu : ${TYPE_FR[t] ?? t})`);
        return; // inutile de poursuivre sur un mauvais type
      }
    }
    if ("const" in s && !deepEqual(v, s.const)) push(`valeur attendue : ${fmt(s.const)} (reçu : ${fmt(v)})`);
    if (s.enum && !s.enum.some((e: unknown) => deepEqual(e, v)))
      push(`valeur ${fmt(v)} non autorisée ; valeurs possibles : ${s.enum.map(fmt).join(", ")}`);

    if (typeof v === "string") {
      if (s.minLength !== undefined && v.length < s.minLength) push("texte vide");
      if (s.pattern && !new RegExp(s.pattern, "u").test(v)) push(`format invalide : ${fmt(v)} (motif ${s.pattern})`);
    }
    if (typeof v === "number") {
      if (s.minimum !== undefined && v < s.minimum) push(`doit être ≥ ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) push(`doit être ≤ ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) push(`au moins ${s.minItems} élément(s) requis (reçu : ${v.length})`);
      if (s.maxItems !== undefined && v.length > s.maxItems) push(`au plus ${s.maxItems} élément(s) autorisé(s) (reçu : ${v.length})`);
      if (s.uniqueItems) {
        const seen = new Set<string>();
        for (const item of v) {
          const k = JSON.stringify(item);
          if (seen.has(k)) push(`élément en double : ${fmt(item)}`);
          seen.add(k);
        }
      }
      if (s.items) v.forEach((item, i) => this.check(s.items, item, `${path}/${i}`, errors));
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (s.required) for (const r of s.required) if (!(r in obj)) push(`champ obligatoire manquant : « ${r} »`);
      if (s.minProperties !== undefined && keys.length < s.minProperties) push(`au moins ${s.minProperties} entrée(s) requise(s)`);
      const props = s.properties ?? {};
      const patterns: [RegExp, Schema][] = Object.entries(s.patternProperties ?? {}).map(([p, sc]) => [new RegExp(p, "u"), sc as Schema]);
      for (const k of keys) {
        let matched = false;
        if (k in props) {
          matched = true;
          this.check(props[k], obj[k], `${path}/${k}`, errors);
        }
        for (const [re, sc] of patterns) {
          if (re.test(k)) {
            matched = true;
            this.check(sc, obj[k], `${path}/${k}`, errors);
          }
        }
        if (!matched && s.additionalProperties !== undefined) {
          if (s.additionalProperties === false) push(`champ non prévu par le format : « ${k} »`);
          else this.check(s.additionalProperties, obj[k], `${path}/${k}`, errors);
        }
      }
    }

    if (s.allOf) for (const sub of s.allOf) this.check(sub, v, path, errors);

    if (s.if !== undefined) {
      const probe: SchemaError[] = [];
      this.check(s.if, v, path, probe);
      if (probe.length === 0) {
        if (s.then !== undefined) this.check(s.then, v, path, errors);
      } else if (s.else !== undefined) this.check(s.else, v, path, errors);
    }

    if (s.oneOf) {
      const results = s.oneOf.map((sub: Schema) => {
        const e: SchemaError[] = [];
        this.check(sub, v, path, e);
        return e;
      });
      const passing = results.filter((r: SchemaError[]) => r.length === 0).length;
      if (passing !== 1) {
        // Discriminant « type » : on rapporte les erreurs de la variante visée.
        const disc = v && typeof v === "object" ? (v as any).type : undefined;
        const idx = s.oneOf.findIndex((sub: any) => sub?.properties?.type?.const === disc);
        if (passing === 0 && idx >= 0) errors.push(...results[idx]);
        else if (passing === 0 && disc !== undefined && s.properties?.type) {
          /* type inconnu : déjà signalé par l'enum */
        } else if (passing === 0) push("ne correspond à aucune forme autorisée");
        else push("correspond à plusieurs formes à la fois (ambigu)");
      }
    }
  }
}
