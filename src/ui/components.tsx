import React, { useEffect, type ReactNode } from "react";

// ——— Icônes (traits simples, 24×24) ———
const PATHS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  book: "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5zM4 19.5V4.5M8 7h8M8 11h6",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  alert: "M12 3 2 20h20zM12 10v4M12 17h.01",
  clipboard: "M9 3h6v3H9zM7 5H5v16h14V5h-2M9 12l2 2 4-4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  folder: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM12 11v5M9.5 13.5 12 11l2.5 2.5",
  check: "M5 12.5 10 17 19 7",
  x: "M6 6l12 12M18 6 6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 18l-6-6 6-6",
  play: "M7 4v16l13-8z",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  flag: "M5 21V4h11l-2 4 2 4H5",
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

export function Bar({ pct, ok }: { pct: number; ok?: boolean }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className={`bar${ok ? " ok" : ""}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

// ——— Texte enrichi restreint : **gras**, *italique*, listes « - » et « 1. » ———
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong> : <em key={`${key}-${i++}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(" "), blocks.length)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, i)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const ul = line.match(/^[-•]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (!line) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <>{blocks}</>;
}

export function Modal({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={`chip${on ? " on" : ""}`} onClick={onClick} aria-pressed={on} disabled={disabled}>
      {children}
    </button>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={o.v === value} className={o.v === value ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}

export const DIFFICULTY_FR: Record<string, string> = { basic: "Facile", intermediate: "Intermédiaire", advanced: "Difficile" };
export const CATEGORY_FR: Record<string, string> = {
  knowledge: "Connaissance",
  definition: "Définition",
  distinction: "Distinction",
  author_date: "Auteurs et dates",
  application: "Application",
  clinical_vignette: "Vignette clinique",
};
export const TYPE_HINT: Record<string, string> = {
  single_choice: "Une seule réponse",
  multiple_choice: "Plusieurs réponses possibles",
  true_false: "Vrai ou faux",
};
export const MODE_FR: Record<string, string> = {
  discovery: "Découverte",
  free: "Libre",
  errors: "Erreurs",
  review: "Révision du jour",
  consolidation: "Consolidation",
  exam: "Partiel blanc",
};

export function fmtDate(iso: string, withTime = false): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}
