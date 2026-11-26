/**
 * Studio CG vocabulary — pure types, constants and validation, safe to
 * import from the control room (client), the operator's editor, the output
 * page and the server actions alike.
 *
 * A graphic is a **template** (a design document + a list of fields) plus
 * the **values** an operator types or pulls from a story. Taking it to air
 * writes a row into `cg_air_item` for one layer; the output page renders
 * whatever is on air. Nothing about layout lives in the database except the
 * document itself, so the same design renders identically in the template
 * thumbnail, the program preview and the 1920×1080 browser source.
 */

export const CG_CANVAS = { width: 1920, height: 1080 };

export const CG_TYPES = [
  "lower_third",
  "breaking",
  "channel_bug",
  "full_frame",
  "two_box",
  "credits",
  "data_plate",
  "custom",
] as const;
export type CgType = (typeof CG_TYPES)[number];

export const CG_TYPE_LABELS: Record<CgType, string> = {
  lower_third: "Lower third",
  breaking: "Breaking news",
  channel_bug: "Channel bug",
  full_frame: "Full frame",
  two_box: "Two-box interview",
  credits: "End credits",
  data_plate: "Live data plate",
  custom: "Custom",
};

/** Library tabs. A template carries one. */
export const CG_CATEGORIES = [
  "lower_thirds",
  "breaking",
  "full_screen",
  "interview",
  "sports",
  "weather",
  "finance",
  "branding",
  "credits",
  "custom",
] as const;
export type CgCategory = (typeof CG_CATEGORIES)[number];

export const CG_CATEGORY_LABELS: Record<CgCategory, string> = {
  lower_thirds: "Lower thirds",
  breaking: "Breaking news",
  full_screen: "Full screen",
  interview: "Interview",
  sports: "Sports",
  weather: "Weather",
  finance: "Finance",
  branding: "Channel branding",
  credits: "Credits",
  custom: "Custom",
};

export const CG_ANIMATIONS = ["none", "fade", "slide_left", "slide_right", "slide_up", "slide_down", "scale"] as const;
export type CgAnimation = (typeof CG_ANIMATIONS)[number];

export const CG_ANIMATION_LABELS: Record<CgAnimation, string> = {
  none: "Cut (no animation)",
  fade: "Fade",
  slide_left: "Slide in from left",
  slide_right: "Slide in from right",
  slide_up: "Slide up",
  slide_down: "Slide down",
  scale: "Scale",
};

/** Animation speed presets, in milliseconds. */
export const CG_SPEEDS = [
  { ms: 200, label: "Fast" },
  { ms: 400, label: "Normal" },
  { ms: 700, label: "Slow" },
  { ms: 1200, label: "Very slow" },
];

/** Duration choices an operator can pick. 0 = manual (stays until taken off). */
export const CG_DURATIONS = [0, 5, 10, 15, 30, 60];

/**
 * Layers, bottom to top. One graphic per layer: taking a second lower third
 * replaces the first rather than stacking two plates on top of each other,
 * which is how a real CG desk behaves. The bug sits above everything so it
 * can stay up while the rest change.
 */
export const CG_LAYERS = [1, 2, 3, 4, 5] as const;
export type CgLayer = (typeof CG_LAYERS)[number];

export const CG_LAYER_LABELS: Record<CgLayer, string> = {
  1: "L1 · Background / full frame",
  2: "L2 · Lower thirds & plates",
  3: "L3 · Breaking / alerts",
  4: "L4 · Overlays & credits",
  5: "L5 · Channel bug",
};

export function defaultLayer(type: CgType): CgLayer {
  switch (type) {
    case "full_frame":
    case "two_box":
      return 1;
    case "breaking":
      return 3;
    case "credits":
      return 4;
    case "channel_bug":
      return 5;
    default:
      return 2;
  }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export const CG_FIELD_KINDS = ["text", "multiline", "list", "image"] as const;
export type CgFieldKind = (typeof CG_FIELD_KINDS)[number];

export type CgField = {
  key: string;
  label: string;
  kind: CgFieldKind;
  /** Shown in the operator's input when empty. */
  placeholder?: string;
  defaultValue?: string;
};

export type CgValues = Record<string, string>;

/** `{{headline}}` in an element's text is replaced by that field's value. */
export function resolveText(text: string, values: CgValues): string {
  return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => values[key.toLowerCase()] ?? "");
}

/** A list field (credits, score rows, market rows) is one entry per line. */
export function listLines(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Story → field mapping for "pull from a story". Only these keys are
 * auto-filled; anything else the operator types. Kept as data so the
 * control room can show exactly what will be replaced before it happens.
 */
export const STORY_FIELD_MAP: { key: string; from: string }[] = [
  { key: "headline", from: "Story headline" },
  { key: "subhead", from: "Story subtitle" },
  { key: "category", from: "Story category" },
  { key: "reporter", from: "Reporter / guest writer" },
  { key: "role", from: "Writer designation" },
  { key: "location", from: "District / division" },
  { key: "image", from: "Featured image" },
  { key: "date", from: "Publish date" },
  { key: "quote", from: "Story excerpt" },
];

// ---------------------------------------------------------------------------
// Design document
// ---------------------------------------------------------------------------

export const CG_ELEMENT_KINDS = ["text", "box", "image", "line"] as const;
export type CgElementKind = (typeof CG_ELEMENT_KINDS)[number];

export const CG_FONTS = ["sans", "display", "mono"] as const;
export type CgFont = (typeof CG_FONTS)[number];

export type CgElement = {
  id: string;
  kind: CgElementKind;
  /** Canvas pixels, top-left origin, always against a 1920×1080 frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  hidden?: boolean;
  locked?: boolean;
  // text
  text?: string;
  font?: CgFont;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  uppercase?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
  /** For a list field: render each line as its own row. */
  listField?: string | null;
  // box / line
  fill?: string;
  fillTo?: string | null;
  gradientAngle?: number;
  radius?: number;
  borderWidth?: number;
  borderColor?: string;
  // image
  src?: string;
  /** Takes its URL from this field's value when set (e.g. "image"). */
  imageField?: string | null;
  fit?: "cover" | "contain";
};

export type CgDocument = {
  width: number;
  height: number;
  /** Draw the 5% title-safe guides in the editor (never in the output). */
  safeArea: boolean;
  elements: CgElement[];
};

export const CG_LIMITS = { elements: 40, textLength: 400, name: 80 };

/**
 * Everything about a graphic other than its design, held aside while an edit
 * is a draft. Published in one go when the operator presses "Publish design".
 */
export type CgDraftMeta = {
  name?: string;
  type?: CgType;
  category?: CgCategory;
  animationIn?: CgAnimation;
  animationOut?: CgAnimation;
  animationMs?: number;
  durationSec?: number;
  layer?: number;
  isEmergency?: boolean;
  needsCheck?: boolean;
  dataSourceId?: string | null;
};

function eid() {
  return `el_${Math.random().toString(36).slice(2, 10)}`;
}

export function newElement(kind: CgElementKind, overrides: Partial<CgElement> = {}): CgElement {
  const base: CgElement = {
    id: eid(),
    kind,
    x: 160,
    y: 760,
    w: kind === "line" ? 600 : 800,
    h: kind === "line" ? 6 : kind === "text" ? 70 : 160,
    opacity: 1,
    ...(kind === "text"
      ? {
          text: "New text",
          font: "sans" as CgFont,
          fontSize: 44,
          fontWeight: 700,
          color: "#ffffff",
          align: "left" as const,
          uppercase: false,
          letterSpacing: 0,
          lineHeight: 1.25,
        }
      : {}),
    ...(kind === "box" || kind === "line"
      ? { fill: kind === "line" ? "#e02424" : "#101114", fillTo: null, gradientAngle: 90, radius: 0, borderWidth: 0, borderColor: "#ffffff" }
      : {}),
    ...(kind === "image" ? { src: "", imageField: null, fit: "cover" as const, radius: 0 } : {}),
  };
  return { ...base, ...overrides };
}

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const colourOrNull = (v: unknown): string | null =>
  typeof v === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|transparent)$/i.test(v.trim()) ? v.trim() : null;

const colour = (v: unknown, fallback: string) =>
  typeof v === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|transparent)$/i.test(v.trim()) ? v.trim() : fallback;

/**
 * Re-validates a document arriving from the browser. Arbitrary client JSON
 * is never stored as-is: a document claiming 900 elements or a 90000px
 * canvas is enough to hang the renderer later (same discipline as the
 * photocard studio's sanitizeDocument).
 */
export function sanitizeDocument(input: unknown): CgDocument {
  const raw = (input ?? {}) as Record<string, unknown>;
  const list = Array.isArray(raw.elements) ? raw.elements.slice(0, CG_LIMITS.elements) : [];
  const elements: CgElement[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const kind = CG_ELEMENT_KINDS.includes(r.kind as CgElementKind) ? (r.kind as CgElementKind) : null;
    if (!kind) continue;
    const base = newElement(kind);
    elements.push({
      ...base,
      id: typeof r.id === "string" && r.id.length <= 40 ? r.id : base.id,
      kind,
      x: num(r.x, base.x, -2000, 4000),
      y: num(r.y, base.y, -2000, 3000),
      w: num(r.w, base.w, 2, 4000),
      h: num(r.h, base.h, 2, 3000),
      opacity: num(r.opacity, 1, 0, 1),
      hidden: !!r.hidden,
      locked: !!r.locked,
      ...(kind === "text"
        ? {
            text: typeof r.text === "string" ? r.text.slice(0, CG_LIMITS.textLength) : base.text,
            font: CG_FONTS.includes(r.font as CgFont) ? (r.font as CgFont) : "sans",
            fontSize: num(r.fontSize, 44, 8, 400),
            fontWeight: num(r.fontWeight, 700, 100, 900),
            color: colour(r.color, "#ffffff"),
            align: r.align === "center" || r.align === "right" ? r.align : "left",
            uppercase: !!r.uppercase,
            letterSpacing: num(r.letterSpacing, 0, -10, 40),
            lineHeight: num(r.lineHeight, 1.25, 1, 3),
            listField: typeof r.listField === "string" && r.listField ? r.listField.slice(0, 40) : null,
          }
        : {}),
      ...(kind === "box" || kind === "line"
        ? {
            fill: colour(r.fill, kind === "line" ? "#e02424" : "#101114"),
            // An unparseable colour becomes "no gradient" rather than a
            // surprise black one: the editor showed no gradient, so saving a
            // black one would mean the stored design differs from the preview.
            fillTo: typeof r.fillTo === "string" && colourOrNull(r.fillTo) ? colourOrNull(r.fillTo) : null,
            gradientAngle: num(r.gradientAngle, 90, 0, 360),
            radius: num(r.radius, 0, 0, 400),
            borderWidth: num(r.borderWidth, 0, 0, 40),
            borderColor: colour(r.borderColor, "#ffffff"),
          }
        : {}),
      ...(kind === "image"
        ? {
            src: typeof r.src === "string" ? r.src.slice(0, 2000) : "",
            imageField: typeof r.imageField === "string" && r.imageField ? r.imageField.slice(0, 40) : null,
            fit: r.fit === "contain" ? "contain" : "cover",
            radius: num(r.radius, 0, 0, 400),
          }
        : {}),
    });
  }
  return {
    width: CG_CANVAS.width,
    height: CG_CANVAS.height,
    safeArea: raw.safeArea !== false,
    elements,
  };
}

export function sanitizeFields(input: unknown): CgField[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: CgField[] = [];
  for (const item of input.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const key = String(r.key ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 40);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 60) : key,
      kind: CG_FIELD_KINDS.includes(r.kind as CgFieldKind) ? (r.kind as CgFieldKind) : "text",
      placeholder: typeof r.placeholder === "string" ? r.placeholder.slice(0, 120) : undefined,
      defaultValue: typeof r.defaultValue === "string" ? r.defaultValue.slice(0, 600) : undefined,
    });
  }
  return out;
}

export function sanitizeValues(input: unknown, fields: CgField[]): CgValues {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: CgValues = {};
  for (const f of fields) {
    const v = raw[f.key];
    out[f.key] = typeof v === "string" ? v.slice(0, f.kind === "list" || f.kind === "multiline" ? 2000 : 400) : f.defaultValue ?? "";
  }
  return out;
}

export function defaultValues(fields: CgField[]): CgValues {
  const out: CgValues = {};
  for (const f of fields) out[f.key] = f.defaultValue ?? "";
  return out;
}

// ---------------------------------------------------------------------------
// Starter templates
// ---------------------------------------------------------------------------

export type StarterTemplate = {
  name: string;
  type: CgType;
  category: CgCategory;
  fields: CgField[];
  document: CgDocument;
  animationIn: CgAnimation;
  animationOut: CgAnimation;
  animationMs: number;
  durationSec: number;
  isEmergency?: boolean;
  /** Bound to a live data source of this kind when one exists. */
  dataKind?: CgDataKind;
};

const doc = (elements: CgElement[]): CgDocument => ({ ...CG_CANVAS, safeArea: true, elements });
const el = (kind: CgElementKind, o: Partial<CgElement>) => newElement(kind, o);

const BRAND = "#e02424";
const INK = "#0d0e11";

/**
 * The starter set. These are real designs, not placeholders: an operator can
 * take any of them to air on a fresh install, and they're the worked
 * examples for building more in the editor. "Restore starter templates"
 * re-creates any that have been deleted.
 */
export function starterTemplates(): StarterTemplate[] {
  return [
    {
      name: "Lower third — Reporter",
      type: "lower_third",
      category: "lower_thirds",
      animationIn: "slide_left",
      animationOut: "fade",
      animationMs: 400,
      durationSec: 0,
      fields: [
        { key: "name", label: "Name", kind: "text", defaultValue: "রফিক আহমেদ" },
        { key: "role", label: "Role", kind: "text", defaultValue: "সিনিয়র রিপোর্টার" },
        { key: "location", label: "Location", kind: "text", defaultValue: "ঢাকা" },
      ],
      document: doc([
        el("box", { x: 120, y: 790, w: 1180, h: 140, fill: "rgba(13,14,17,0.92)", fillTo: "rgba(13,14,17,0.55)", gradientAngle: 90 }),
        el("box", { x: 120, y: 790, w: 14, h: 140, fill: BRAND }),
        el("text", { x: 170, y: 812, w: 1080, h: 60, text: "{{name}}", fontSize: 54, fontWeight: 800, color: "#ffffff" }),
        el("text", {
          x: 170,
          y: 876,
          w: 1080,
          h: 40,
          text: "{{role}} · {{location}}",
          fontSize: 30,
          fontWeight: 500,
          color: "rgba(255,255,255,0.72)",
        }),
      ]),
    },
    {
      name: "Breaking news plate",
      type: "breaking",
      category: "breaking",
      animationIn: "slide_up",
      animationOut: "fade",
      animationMs: 300,
      durationSec: 15,
      fields: [
        { key: "label", label: "Label", kind: "text", defaultValue: "ব্রেকিং নিউজ" },
        { key: "headline", label: "Headline", kind: "multiline", placeholder: "One line is best on air" },
        { key: "time", label: "Timestamp", kind: "text", placeholder: "10:32" },
      ],
      document: doc([
        el("box", { x: 0, y: 700, w: 1920, h: 70, fill: BRAND }),
        el("text", {
          x: 60,
          y: 716,
          w: 500,
          h: 40,
          text: "{{label}}",
          fontSize: 34,
          fontWeight: 900,
          color: "#ffffff",
          uppercase: true,
          letterSpacing: 6,
        }),
        el("text", { x: 1500, y: 718, w: 360, h: 40, text: "{{time}}", fontSize: 30, fontWeight: 700, color: "rgba(255,255,255,0.85)", align: "right" }),
        el("box", { x: 0, y: 770, w: 1920, h: 120, fill: "rgba(13,14,17,0.94)" }),
        el("text", { x: 60, y: 792, w: 1800, h: 80, text: "{{headline}}", fontSize: 58, fontWeight: 800, color: "#ffffff", lineHeight: 1.2 }),
      ]),
    },
    {
      name: "Channel bug",
      type: "channel_bug",
      category: "branding",
      animationIn: "fade",
      animationOut: "fade",
      animationMs: 400,
      durationSec: 0,
      fields: [
        { key: "channel", label: "Channel name", kind: "text", defaultValue: "Digital Connect" },
        { key: "logo", label: "Logo URL", kind: "image" },
      ],
      document: doc([
        el("box", { x: 1560, y: 60, w: 300, h: 92, fill: "rgba(13,14,17,0.55)", radius: 10, borderWidth: 2, borderColor: "rgba(255,255,255,0.18)" }),
        el("image", { x: 1580, y: 76, w: 60, h: 60, imageField: "logo", fit: "contain", radius: 6 }),
        el("text", { x: 1652, y: 90, w: 190, h: 40, text: "{{channel}}", fontSize: 26, fontWeight: 800, color: "#ffffff" }),
      ]),
    },
    {
      name: "Full-frame quote",
      type: "full_frame",
      category: "full_screen",
      animationIn: "fade",
      animationOut: "fade",
      animationMs: 500,
      durationSec: 0,
      fields: [
        { key: "quote", label: "Quote", kind: "multiline" },
        { key: "name", label: "Person", kind: "text" },
        { key: "role", label: "Role", kind: "text" },
      ],
      document: doc([
        el("box", { x: 0, y: 0, w: 1920, h: 1080, fill: INK, fillTo: "#23262e", gradientAngle: 135 }),
        el("text", { x: 180, y: 220, w: 120, h: 160, text: "“", fontSize: 200, fontWeight: 900, color: BRAND }),
        el("text", { x: 300, y: 300, w: 1440, h: 400, text: "{{quote}}", font: "display", fontSize: 76, fontWeight: 700, color: "#ffffff", lineHeight: 1.35 }),
        el("line", { x: 300, y: 760, w: 160, h: 6, fill: BRAND }),
        el("text", { x: 300, y: 800, w: 1200, h: 50, text: "{{name}}", fontSize: 40, fontWeight: 800, color: "#ffffff" }),
        el("text", { x: 300, y: 856, w: 1200, h: 40, text: "{{role}}", fontSize: 30, fontWeight: 500, color: "rgba(255,255,255,0.7)" }),
      ]),
    },
    {
      name: "Two-box interview",
      type: "two_box",
      category: "interview",
      animationIn: "slide_up",
      animationOut: "fade",
      animationMs: 400,
      durationSec: 0,
      fields: [
        { key: "name1", label: "Left name", kind: "text" },
        { key: "role1", label: "Left role", kind: "text" },
        { key: "name2", label: "Right name", kind: "text" },
        { key: "role2", label: "Right role", kind: "text" },
        { key: "topic", label: "Topic strap", kind: "text" },
      ],
      document: doc([
        el("box", { x: 0, y: 820, w: 960, h: 130, fill: "rgba(13,14,17,0.92)" }),
        el("box", { x: 960, y: 820, w: 960, h: 130, fill: "rgba(13,14,17,0.82)" }),
        el("box", { x: 956, y: 820, w: 8, h: 130, fill: BRAND }),
        el("text", { x: 60, y: 840, w: 840, h: 50, text: "{{name1}}", fontSize: 44, fontWeight: 800, color: "#ffffff" }),
        el("text", { x: 60, y: 894, w: 840, h: 40, text: "{{role1}}", fontSize: 28, fontWeight: 500, color: "rgba(255,255,255,0.7)" }),
        el("text", { x: 1020, y: 840, w: 840, h: 50, text: "{{name2}}", fontSize: 44, fontWeight: 800, color: "#ffffff" }),
        el("text", { x: 1020, y: 894, w: 840, h: 40, text: "{{role2}}", fontSize: 28, fontWeight: 500, color: "rgba(255,255,255,0.7)" }),
        el("box", { x: 0, y: 950, w: 1920, h: 56, fill: BRAND }),
        el("text", { x: 60, y: 962, w: 1800, h: 36, text: "{{topic}}", fontSize: 28, fontWeight: 700, color: "#ffffff", uppercase: true, letterSpacing: 4 }),
      ]),
    },
    {
      name: "End credits roll",
      type: "credits",
      category: "credits",
      animationIn: "fade",
      animationOut: "fade",
      animationMs: 600,
      durationSec: 0,
      fields: [
        { key: "title", label: "Programme", kind: "text", defaultValue: "Digital Connect News" },
        {
          key: "credits",
          label: "Credits (one per line)",
          kind: "list",
          defaultValue: "Editor — \nProducer — \nReporter — \nCamera — \nGraphics — ",
        },
      ],
      document: doc([
        el("box", { x: 0, y: 0, w: 1920, h: 1080, fill: "rgba(13,14,17,0.88)" }),
        el("text", { x: 260, y: 140, w: 1400, h: 70, text: "{{title}}", font: "display", fontSize: 58, fontWeight: 800, color: "#ffffff", align: "center" }),
        el("line", { x: 860, y: 230, w: 200, h: 4, fill: BRAND }),
        el("text", {
          x: 260,
          y: 290,
          w: 1400,
          h: 640,
          text: "",
          listField: "credits",
          fontSize: 40,
          fontWeight: 600,
          color: "rgba(255,255,255,0.88)",
          align: "center",
          lineHeight: 1.6,
        }),
      ]),
    },
    {
      name: "Weather plate — Dhaka",
      type: "data_plate",
      category: "weather",
      dataKind: "weather",
      animationIn: "slide_right",
      animationOut: "fade",
      animationMs: 400,
      durationSec: 15,
      fields: [
        { key: "place", label: "Location", kind: "text", defaultValue: "ঢাকা" },
        { key: "temp", label: "Temperature", kind: "text" },
        { key: "rain", label: "Rain chance", kind: "text" },
        { key: "humidity", label: "Humidity", kind: "text" },
        { key: "updated", label: "Updated", kind: "text" },
      ],
      document: doc([
        el("box", { x: 1240, y: 220, w: 560, h: 380, fill: "rgba(13,14,17,0.92)", fillTo: "rgba(35,38,46,0.92)", gradientAngle: 160, radius: 18 }),
        el("box", { x: 1240, y: 220, w: 560, h: 8, fill: "#3b82f6" }),
        el("text", { x: 1290, y: 260, w: 460, h: 50, text: "{{place}}", fontSize: 42, fontWeight: 800, color: "#ffffff" }),
        el("text", { x: 1290, y: 320, w: 460, h: 110, text: "{{temp}}", fontSize: 96, fontWeight: 900, color: "#ffffff" }),
        el("text", { x: 1290, y: 450, w: 460, h: 40, text: "বৃষ্টি {{rain}}", fontSize: 30, fontWeight: 600, color: "rgba(255,255,255,0.8)" }),
        el("text", { x: 1290, y: 496, w: 460, h: 40, text: "আর্দ্রতা {{humidity}}", fontSize: 30, fontWeight: 600, color: "rgba(255,255,255,0.8)" }),
        el("text", { x: 1290, y: 550, w: 460, h: 30, text: "{{updated}}", font: "mono", fontSize: 22, fontWeight: 500, color: "rgba(255,255,255,0.5)" }),
      ]),
    },
    {
      name: "Cricket score",
      type: "data_plate",
      category: "sports",
      dataKind: "sports",
      animationIn: "slide_up",
      animationOut: "fade",
      animationMs: 350,
      durationSec: 0,
      fields: [
        { key: "competition", label: "Match / series", kind: "text" },
        { key: "rows", label: "Score rows (one per line)", kind: "list", placeholder: "Bangladesh 210/6\nIndia 198/8" },
        { key: "status", label: "Status / overs", kind: "text", placeholder: "38.4 overs" },
      ],
      document: doc([
        el("box", { x: 120, y: 760, w: 900, h: 200, fill: "rgba(13,14,17,0.94)", radius: 14 }),
        el("box", { x: 120, y: 760, w: 900, h: 52, fill: BRAND, radius: 14 }),
        el("text", { x: 150, y: 772, w: 840, h: 34, text: "{{competition}}", fontSize: 26, fontWeight: 800, color: "#ffffff", uppercase: true, letterSpacing: 3 }),
        el("text", { x: 150, y: 830, w: 840, h: 90, text: "", listField: "rows", font: "mono", fontSize: 38, fontWeight: 700, color: "#ffffff", lineHeight: 1.25 }),
        el("text", { x: 150, y: 918, w: 840, h: 32, text: "{{status}}", fontSize: 24, fontWeight: 600, color: "rgba(255,255,255,0.65)" }),
      ]),
    },
    {
      name: "Market index",
      type: "data_plate",
      category: "finance",
      dataKind: "market",
      animationIn: "slide_left",
      animationOut: "fade",
      animationMs: 350,
      durationSec: 20,
      fields: [
        { key: "title", label: "Title", kind: "text", defaultValue: "শেয়ারবাজার" },
        { key: "rows", label: "Rows (one per line)", kind: "list", placeholder: "DSEX 6,840 ▲ 12.00" },
        { key: "updated", label: "Updated", kind: "text" },
      ],
      document: doc([
        el("box", { x: 120, y: 700, w: 820, h: 270, fill: "rgba(13,14,17,0.94)", radius: 14 }),
        el("text", { x: 156, y: 726, w: 760, h: 40, text: "{{title}}", fontSize: 32, fontWeight: 800, color: "#ffffff", uppercase: true, letterSpacing: 4 }),
        el("line", { x: 156, y: 778, w: 120, h: 4, fill: BRAND }),
        el("text", { x: 156, y: 800, w: 760, h: 130, text: "", listField: "rows", font: "mono", fontSize: 34, fontWeight: 700, color: "#ffffff", lineHeight: 1.4 }),
        el("text", { x: 156, y: 930, w: 760, h: 30, text: "{{updated}}", font: "mono", fontSize: 20, fontWeight: 500, color: "rgba(255,255,255,0.5)" }),
      ]),
    },
    {
      name: "Technical difficulty",
      type: "full_frame",
      category: "full_screen",
      isEmergency: true,
      animationIn: "fade",
      animationOut: "fade",
      animationMs: 250,
      durationSec: 0,
      fields: [
        { key: "headline", label: "Headline", kind: "text", defaultValue: "কিছু কারণে সম্প্রচার বিঘ্নিত হচ্ছে" },
        { key: "sub", label: "Sub line", kind: "text", defaultValue: "আমরা দ্রুত ফিরে আসছি" },
      ],
      document: doc([
        el("box", { x: 0, y: 0, w: 1920, h: 1080, fill: INK }),
        el("box", { x: 0, y: 440, w: 1920, h: 10, fill: BRAND }),
        el("text", { x: 160, y: 480, w: 1600, h: 90, text: "{{headline}}", fontSize: 68, fontWeight: 800, color: "#ffffff", align: "center" }),
        el("text", { x: 160, y: 590, w: 1600, h: 50, text: "{{sub}}", fontSize: 36, fontWeight: 500, color: "rgba(255,255,255,0.7)", align: "center" }),
      ]),
    },
    {
      name: "Live interruption",
      type: "breaking",
      category: "breaking",
      isEmergency: true,
      animationIn: "slide_up",
      animationOut: "fade",
      animationMs: 250,
      durationSec: 0,
      fields: [
        { key: "label", label: "Label", kind: "text", defaultValue: "সরাসরি" },
        { key: "headline", label: "Headline", kind: "multiline", defaultValue: "সংবাদ সম্মেলন শুরু হচ্ছে" },
      ],
      document: doc([
        el("box", { x: 0, y: 780, w: 1920, h: 150, fill: BRAND, fillTo: "#8f1414", gradientAngle: 90 }),
        el("text", { x: 60, y: 800, w: 360, h: 44, text: "{{label}}", fontSize: 32, fontWeight: 900, color: "#ffffff", uppercase: true, letterSpacing: 8 }),
        el("text", { x: 60, y: 852, w: 1800, h: 64, text: "{{headline}}", fontSize: 54, fontWeight: 800, color: "#ffffff" }),
      ]),
    },
  ];
}

// ---------------------------------------------------------------------------
// Live data sources
// ---------------------------------------------------------------------------

export const CG_DATA_KINDS = ["weather", "sports", "market", "custom"] as const;
export type CgDataKind = (typeof CG_DATA_KINDS)[number];

export const CG_DATA_KIND_LABELS: Record<CgDataKind, string> = {
  weather: "Weather (Open-Meteo)",
  sports: "Sports score",
  market: "Market / index",
  custom: "Custom data",
};

export const CG_DATA_MODES = ["manual", "http", "open_meteo"] as const;
export type CgDataMode = (typeof CG_DATA_MODES)[number];

export const CG_DATA_MODE_LABELS: Record<CgDataMode, string> = {
  manual: "Typed in by an operator",
  http: "Fetched from a JSON endpoint",
  open_meteo: "Open-Meteo live weather (no API key)",
};

/**
 * How a plate gets its numbers.
 *
 * `manual` — an operator types the rows; they persist and can be corrected
 * between takes. `open_meteo` — real current weather for a lat/lon, from a
 * free keyless API. `http` — any JSON endpoint the newsroom already has,
 * with a dotted path per field (`data.dsex.last`) and an optional path to a
 * list of rows plus a row template. There is no bundled cricket or DSE
 * feed: those are commercial, so this is the honest seam for plugging one
 * in without code changes.
 */
export type CgDataConfig = {
  mode: CgDataMode;
  /** open_meteo */
  lat?: number;
  lon?: number;
  place?: string;
  /** http */
  url?: string;
  headerName?: string;
  headerValue?: string;
  /** field key → dotted path into the JSON response */
  paths?: Record<string, string>;
  /** dotted path to an array, rendered one line each with rowTemplate */
  listPath?: string;
  /** e.g. "{name} {score} {change}" — {key} reads each row object's key */
  rowTemplate?: string;
  /** which field the rendered lines are written into */
  listField?: string;
  /** manual */
  values?: CgValues;
};

export function sanitizeDataConfig(input: unknown): CgDataConfig {
  const r = (input ?? {}) as Record<string, unknown>;
  const mode = CG_DATA_MODES.includes(r.mode as CgDataMode) ? (r.mode as CgDataMode) : "manual";
  const paths: Record<string, string> = {};
  if (r.paths && typeof r.paths === "object") {
    for (const [k, v] of Object.entries(r.paths as Record<string, unknown>).slice(0, 20)) {
      if (typeof v === "string" && v.trim()) paths[k.slice(0, 40)] = v.trim().slice(0, 200);
    }
  }
  const values: CgValues = {};
  if (r.values && typeof r.values === "object") {
    for (const [k, v] of Object.entries(r.values as Record<string, unknown>).slice(0, 20)) {
      if (typeof v === "string") values[k.slice(0, 40)] = v.slice(0, 2000);
    }
  }
  return {
    mode,
    lat: Number.isFinite(Number(r.lat)) ? num(r.lat, 23.81, -90, 90) : undefined,
    lon: Number.isFinite(Number(r.lon)) ? num(r.lon, 90.41, -180, 180) : undefined,
    place: typeof r.place === "string" ? r.place.slice(0, 80) : undefined,
    url: typeof r.url === "string" ? r.url.trim().slice(0, 1000) : undefined,
    headerName: typeof r.headerName === "string" ? r.headerName.slice(0, 80) : undefined,
    headerValue: typeof r.headerValue === "string" ? r.headerValue.slice(0, 400) : undefined,
    paths,
    listPath: typeof r.listPath === "string" ? r.listPath.trim().slice(0, 200) : undefined,
    rowTemplate: typeof r.rowTemplate === "string" ? r.rowTemplate.slice(0, 200) : undefined,
    listField: typeof r.listField === "string" ? r.listField.slice(0, 40) : undefined,
    values,
  };
}

export const REFRESH_CHOICES = [0, 15, 30, 60, 300];

/** Human label for a refresh interval in seconds (0 = off). */
export function refreshLabel(sec: number) {
  if (!sec) return "Manual only";
  if (sec < 60) return `Every ${sec}s`;
  return `Every ${Math.round(sec / 60)} min`;
}
