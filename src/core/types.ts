// Types du format de contenus (miroir de contenu-format/psycho304-content.schema.json)

export type ReviewStatus = "draft" | "to_review" | "validated" | "needs_revision" | "retired";

export interface SourceRef { source_id: string; location: string; note?: string }

export interface PackMeta {
  id: string;
  title: string;
  version: number;
  kind: "content" | "demo" | "example";
  generated_at: string;
  generator?: string;
  description?: string;
  changelog?: { version: number; date: string; changes: string }[];
}

export interface Source {
  id: string;
  kind: "CM" | "TD" | "article" | "book" | "other";
  part_id?: string;
  number?: number;
  title: string;
  authors?: string[];
  year?: number;
  file_name?: string;
  url?: string;
  location_unit?: string;
  integration_status: "integrated" | "partial" | "pending" | "unavailable";
  notes?: string;
}

export interface Part { id: string; title: string; order: number; description?: string }

export interface Module {
  id: string;
  part_id: string;
  number: number;
  title: string;
  description?: string;
  source_ids?: string[];
  status?: "active" | "planned";
}

export interface Concept {
  id: string;
  module_id: string;
  title: string;
  summary?: string;
  sources: SourceRef[];
  assessment: "evaluated" | "not_evaluated" | "to_confirm";
  importance?: "core" | "standard" | "detail";
  verification_status: "verified" | "to_verify" | "disputed";
  authors?: string[];
  keywords?: string[];
  confusable_with?: string[];
  prerequisites?: string[];
  version?: number;
  notes?: string;
}

export interface TreeNode { label: string; detail?: string; children?: TreeNode[] }

export type Block =
  | { type: "text"; text: string }
  | { type: "key_point"; text: string }
  | { type: "definition"; term: string; definition: string; concept_id?: string; author?: string; source?: SourceRef }
  | { type: "table"; title?: string; columns: string[]; rows: string[][]; caption?: string }
  | { type: "diagram"; kind: "flow"; title?: string; steps: { label: string; detail?: string }[]; caption?: string }
  | { type: "diagram"; kind: "tree"; title?: string; root: TreeNode; caption?: string }
  | { type: "author"; name: string; dates?: string; contribution: string; key_works?: { title: string; year?: number }[]; concept_ids?: string[] }
  | { type: "example"; title?: string; text: string }
  | { type: "pitfall"; text: string; concept_ids?: string[] };

export interface Section { id: string; title: string; concept_ids: string[]; sources?: SourceRef[]; blocks: Block[] }

export interface Course {
  id: string;
  module_id: string;
  title: string;
  introduction?: string;
  sections: Section[];
  review_status: ReviewStatus;
  version: number;
}

export interface Option { id: string; text: string; confusion_concept_id?: string }

export type QuestionType = "single_choice" | "multiple_choice" | "true_false";
export type Difficulty = "basic" | "intermediate" | "advanced";

export interface Question {
  id: string;
  module_id: string;
  concept_ids: string[];
  type: QuestionType;
  category: "knowledge" | "definition" | "distinction" | "author_date" | "application" | "clinical_vignette";
  difficulty: Difficulty;
  vignette?: string;
  question: string;
  options: Option[];
  correct_option_ids: string[];
  shuffle_options?: boolean;
  explanation: string;
  option_explanations: Record<string, string>;
  sources: SourceRef[];
  course_section_ids?: string[];
  variant_group?: string;
  tags?: string[];
  review_status: ReviewStatus;
  version: number;
  revision_note?: string;
}

export interface ContentPack {
  $schema?: string;
  format: "psycho304-content";
  format_version: "1.0.0";
  pack: PackMeta;
  sources?: Source[];
  parts?: Part[];
  modules?: Module[];
  concepts?: Concept[];
  courses?: Course[];
  questions?: Question[];
}

export const COLLECTIONS = ["sources", "parts", "modules", "concepts", "courses", "questions"] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

/** Métadonnées ajoutées par l'application à chaque élément stocké. */
export interface Stored {
  _pack?: string; // clé du paquet d'origine (id@version)
  _needs_recheck?: boolean; // contenu modifié : revérification pédagogique conseillée
  _updated_at?: string;
}

export type StoredOf<T> = T & Stored;

/** État complet des contenus en mémoire. */
export interface ContentState {
  sources: Map<string, StoredOf<Source>>;
  parts: Map<string, StoredOf<Part>>;
  modules: Map<string, StoredOf<Module>>;
  concepts: Map<string, StoredOf<Concept>>;
  courses: Map<string, StoredOf<Course>>;
  questions: Map<string, StoredOf<Question>>;
}

export function emptyContent(): ContentState {
  return {
    sources: new Map(),
    parts: new Map(),
    modules: new Map(),
    concepts: new Map(),
    courses: new Map(),
    questions: new Map(),
  };
}

// ——— Progression ———

export type Confidence = "guess" | "unsure" | "sure";
export type TrainingMode = "discovery" | "free" | "errors" | "review" | "consolidation" | "exam";

export interface Attempt {
  id: string;
  session_id: string;
  question_id: string;
  question_version: number;
  concept_ids: string[];
  module_id: string;
  selected_option_ids: string[];
  displayed_option_ids: string[]; // ordre affiché
  correct: boolean;
  score: number; // 0..1 selon le barème
  confidence: Confidence | null;
  duration_ms: number;
  answered_at: string; // ISO
  mode: TrainingMode;
  first_seen: boolean; // première rencontre de cette question
  device_id: string;
  _synced?: 0 | 1;
}

export interface SessionConfig {
  mode: TrainingMode;
  part_ids: string[];
  module_ids: string[];
  difficulties: Difficulty[];
  count: number;
  novelty: "all" | "new" | "seen";
  shuffle_questions: boolean;
  shuffle_options: boolean;
}

export interface SessionRecord {
  id: string;
  config: SessionConfig;
  question_ids: string[];
  started_at: string;
  ended_at?: string;
  answered: number;
  correct: number;
  score_20?: number;
  duration_ms: number;
  updated_at: string;
  device_id: string;
  _synced?: 0 | 1;
}

export type ScoringRule = "all_or_nothing" | "partial" | "partial_with_penalty";

export interface Settings {
  exam_date: string | null; // AAAA-MM-JJ
  theme: "dark" | "light";
  multiple_scoring: ScoringRule;
  ask_confidence: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  exam_date: null,
  theme: "dark",
  multiple_scoring: "all_or_nothing",
  ask_confidence: true,
};
